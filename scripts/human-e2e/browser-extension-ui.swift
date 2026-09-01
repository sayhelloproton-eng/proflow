import AppKit
import ApplicationServices
import Foundation

let extensionName = ProcessInfo.processInfo.environment["PROFLOW_BROWSER_EXTENSION_NAME"] ?? "ProFlow Execution Browser"
let action = CommandLine.arguments.dropFirst().first(where: { $0 != "--" }) ?? "status"
let started = Date()

func attribute(_ element: AXUIElement, _ name: CFString) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value as AnyObject?
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    (attribute(element, name) as? String) ?? ""
}

func role(_ element: AXUIElement) -> String { stringAttribute(element, kAXRoleAttribute as CFString) }

func text(_ element: AXUIElement) -> String {
    [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute, kAXHelpAttribute]
        .map { stringAttribute(element, $0 as CFString) }
        .filter { !$0.isEmpty }
        .joined(separator: " | ")
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement]) ?? []
}

func flatten(_ root: AXUIElement) -> [AXUIElement] {
    var result: [AXUIElement] = []
    var stack = [root]
    var seen = 0
    while let current = stack.popLast(), seen < 5000 {
        seen += 1
        result.append(current)
        stack.append(contentsOf: children(current).reversed())
    }
    return result
}

func chrome() -> (NSRunningApplication, AXUIElement) {
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.google.Chrome" }) else {
        fatalError("CHROME_NOT_RUNNING")
    }
    app.activate(options: [.activateIgnoringOtherApps])
    usleep(250_000)
    return (app, AXUIElementCreateApplication(app.processIdentifier))
}

func bounds(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute as CFString),
          let s = attribute(element, kAXSizeAttribute as CFString) else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}

func click(_ element: AXUIElement) throws {
    guard let rect = bounds(element) else { throw NSError(domain: "human-e2e", code: 1, userInfo: [NSLocalizedDescriptionKey: "ELEMENT_BOUNDS_MISSING"]) }
    let point = CGPoint(x: rect.midX, y: rect.midY)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func key(_ code: CGKeyCode, flags: CGEventFlags = []) {
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

func wait(_ seconds: TimeInterval, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        if condition() { return true }
        usleep(120_000)
    }
    return condition()
}

let (_, root) = chrome()
func nodes() -> [AXUIElement] { flatten(root) }
func extensionPresent() -> Bool { nodes().contains { text($0).contains(extensionName) } }
func button(named names: Set<String>) -> AXUIElement? {
    nodes().first { role($0) == kAXButtonRole as String && names.contains(stringAttribute($0, kAXTitleAttribute as CFString)) }
}
func removeButtonAfterExtension() -> AXUIElement? {
    let all = nodes()
    guard let index = all.firstIndex(where: { text($0).contains(extensionName) }) else { return nil }
    return all.dropFirst(index + 1).first {
        role($0) == kAXButtonRole as String && ["移除", "Remove"].contains(stringAttribute($0, kAXTitleAttribute as CFString))
    }
}
func confirmationVisible() -> Bool {
    nodes().contains {
        let value = text($0)
        return value.contains(extensionName) && (value.contains("要删除") || value.lowercased().contains("remove"))
    }
}
func pickerVisible() -> Bool {
    let all = nodes()
    let hasTitle = all.contains { let v = text($0); return v.contains("选择扩展程序目录") || v.lowercased().contains("select extension directory") }
    let hasSelect = all.contains { role($0) == kAXButtonRole as String && ["选择", "Select"].contains(stringAttribute($0, kAXTitleAttribute as CFString)) }
    return hasTitle && hasSelect
}
func textFieldCount() -> Int {
    nodes().filter { role($0) == kAXTextFieldRole as String }.count
}

func ensureExtensionsPage() throws {
    if button(named: ["加载未打包的扩展程序", "Load unpacked"]) != nil { return }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["-a", "Google Chrome", "chrome://extensions"]
    try process.run()
    process.waitUntilExit()
    guard wait(8.0, { button(named: ["加载未打包的扩展程序", "Load unpacked"]) != nil }) else {
        throw NSError(domain: "human-e2e", code: 10, userInfo: [NSLocalizedDescriptionKey: "EXTENSIONS_PAGE_NOT_READY"])
    }
}

func screenshot(_ suffix: String) {
    let path = "/tmp/proflow-browser-harness-\(suffix)-\(Int(Date().timeIntervalSince1970)).png"
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); p.arguments = ["-x", path]
    try? p.run(); p.waitUntilExit(); fputs("SCREENSHOT=\(path)\n", stderr)
}

func finish(_ result: String) {
    print("BROWSER_UI_RESULT=\(result)")
    print(String(format: "BROWSER_UI_SECONDS=%.3f", Date().timeIntervalSince(started)))
}

do {
    try ensureExtensionsPage()
    switch action {
    case "status":
        finish(extensionPresent() ? "PRESENT" : "MISSING")
    case "uninstall":
        if !extensionPresent() { finish("ALREADY_MISSING"); exit(0) }
        guard let remove = removeButtonAfterExtension() else { throw NSError(domain: "human-e2e", code: 2, userInfo: [NSLocalizedDescriptionKey: "REMOVE_BUTTON_NOT_FOUND"]) }
        try click(remove)
        guard wait(3.0, confirmationVisible) else { throw NSError(domain: "human-e2e", code: 3, userInfo: [NSLocalizedDescriptionKey: "REMOVE_CONFIRMATION_NOT_VISIBLE"]) }
        key(36)
        guard wait(8.0, { !extensionPresent() }) else { throw NSError(domain: "human-e2e", code: 4, userInfo: [NSLocalizedDescriptionKey: "EXTENSION_STILL_PRESENT_AFTER_REMOVE"]) }
        finish("UNINSTALLED")
    case "install":
        if extensionPresent() { finish("ALREADY_PRESENT"); exit(0) }
        for _ in 0..<3 where pickerVisible() {
            key(53)
            usleep(250_000)
        }
        guard wait(3.0, { !pickerVisible() }) else { throw NSError(domain: "human-e2e", code: 5, userInfo: [NSLocalizedDescriptionKey: "STALE_PICKER_NOT_CLOSED"]) }
        guard let load = button(named: ["加载未打包的扩展程序", "Load unpacked"]) else { throw NSError(domain: "human-e2e", code: 6, userInfo: [NSLocalizedDescriptionKey: "LOAD_UNPACKED_NOT_FOUND"]) }
        try click(load)
        guard wait(5.0, pickerVisible) else { throw NSError(domain: "human-e2e", code: 7, userInfo: [NSLocalizedDescriptionKey: "DIRECTORY_PICKER_NOT_VISIBLE"]) }
        let baselineTextFields = textFieldCount()
        key(5, flags: [.maskCommand, .maskShift])
        guard wait(3.0, { textFieldCount() > baselineTextFields }) else { throw NSError(domain: "human-e2e", code: 8, userInfo: [NSLocalizedDescriptionKey: "GO_TO_FOLDER_SHEET_NOT_VISIBLE"]) }
        key(9, flags: [.maskCommand])
        usleep(150_000)
        key(36)
        guard wait(5.0, { textFieldCount() <= baselineTextFields && pickerVisible() }) else { throw NSError(domain: "human-e2e", code: 9, userInfo: [NSLocalizedDescriptionKey: "LOAD_DIRECTORY_NOT_READY"]) }
        usleep(250_000)
        key(36)
        guard wait(12.0, extensionPresent) else { throw NSError(domain: "human-e2e", code: 11, userInfo: [NSLocalizedDescriptionKey: "EXTENSION_CARD_NOT_VISIBLE_AFTER_SELECT"]) }
        finish("INSTALLED")
    default:
        fputs("Usage: swift scripts/human-e2e/browser-extension-ui.swift status|install|uninstall\n", stderr)
        exit(64)
    }
} catch {
    screenshot(action)
    fputs("BROWSER_UI_ERROR=\(error.localizedDescription)\n", stderr)
    finish("FAILED")
    exit(1)
}
