import AppKit
import ApplicationServices
import Foundation

let extensionName = ProcessInfo.processInfo.environment["PROFLOW_BROWSER_EXTENSION_NAME"] ?? "ProFlow Execution Browser"
let action = CommandLine.arguments.dropFirst().first(where: { $0 != "--" }) ?? "status"
let started = Date()
let previousFrontmost = NSWorkspace.shared.frontmostApplication
let privilegedActions: Set<String> = [
    "dismiss-help", "open-extensions-menu", "open-proflow-tasks", "inspect-tab-strip",
    "select-tab", "attach-tab-to-playwright-group", "status", "reload", "install", "uninstall",
]
let mayActivateChrome = privilegedActions.contains(action)

func attribute(_ element: AXUIElement, _ name: CFString) -> AnyObject? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value as AnyObject?
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String {
    (attribute(element, name) as? String) ?? ""
}

func enabled(_ element: AXUIElement) -> Bool {
    (attribute(element, kAXEnabledAttribute as CFString) as? Bool) ?? true
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

func chrome(activate: Bool = false) -> (NSRunningApplication, AXUIElement) {
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == "com.google.Chrome" }) else {
        fatalError("CHROME_NOT_RUNNING")
    }
    if activate {
        app.activate(options: [.activateIgnoringOtherApps])
        usleep(250_000)
    }
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

let (_, root) = chrome(activate: mayActivateChrome)
func scanRoot() -> AXUIElement {
    guard let focused = attribute(root, kAXFocusedWindowAttribute as CFString) else { return root }
    return focused as! AXUIElement
}
func nodes() -> [AXUIElement] { flatten(scanRoot()) }
func extensionPresent() -> Bool { nodes().contains { text($0).contains(extensionName) } }
func button(named names: Set<String>) -> AXUIElement? {
    nodes().first {
        guard role($0) == kAXButtonRole as String else { return false }
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        let combined = text($0)
        return names.contains(title) || names.contains(combined)
    }
}
func popUpButton(named names: Set<String>) -> AXUIElement? {
    nodes().first {
        guard role($0) == kAXPopUpButtonRole as String else { return false }
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        let combined = text($0)
        return names.contains(title) || names.contains(combined)
    }
}
func pressable(named names: Set<String>) -> AXUIElement? {
    nodes().first { element in
        let title = stringAttribute(element, kAXTitleAttribute as CFString)
        let combined = text(element)
        guard names.contains(title) || names.contains(combined) else { return false }
        var actions: CFArray?
        guard AXUIElementCopyActionNames(element, &actions) == .success,
              let values = actions as? [String] else { return false }
        return values.contains(kAXPressAction as String)
    }
}
func removeButtonAfterExtension() -> AXUIElement? {
    let all = nodes()
    guard let index = all.firstIndex(where: { text($0).contains(extensionName) }) else { return nil }
    return all.dropFirst(index + 1).first {
        guard role($0) == kAXButtonRole as String else { return false }
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        let combined = text($0)
        return ["移除", "Remove"].contains(title) || ["移除", "Remove"].contains(combined)
    }
}
func reloadButtonAfterExtension() -> AXUIElement? {
    let all = nodes()
    guard let index = all.firstIndex(where: { text($0).contains(extensionName) }) else { return nil }
    return all.dropFirst(index + 1).first {
        guard role($0) == kAXButtonRole as String else { return false }
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        let combined = text($0)
        return ["重新加载", "Reload"].contains(title) || ["重新加载", "Reload"].contains(combined)
    }
}
func confirmationVisible() -> Bool {
    nodes().contains {
        let value = text($0)
        let lower = value.lowercased()
        return value.contains(extensionName) && (value.contains("要删除") || value.contains("要移除") || lower.contains("remove"))
    }
}
func pickerVisible() -> Bool {
    let all = nodes()
    let hasTitle = all.contains { let v = text($0); return v.contains("选择扩展程序目录") || v.lowercased().contains("select extension directory") }
    let hasSelect = all.contains { role($0) == kAXButtonRole as String && ["选择", "Select"].contains(stringAttribute($0, kAXTitleAttribute as CFString)) }
    return hasTitle && hasSelect
}
func goToFolderVisible() -> Bool {
    nodes().contains {
        let value = text($0).lowercased()
        return value.contains("前往：") || value.contains("前往:") || value.contains("go to the folder")
    }
}

func ensureExtensionsPage() throws {
    for _ in 0..<4 {
        if !goToFolderVisible() && !pickerVisible() { break }
        key(53)
        usleep(250_000)
    }
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
    guard mayActivateChrome else {
        fputs("SCREENSHOT_SKIPPED_NON_PRIVILEGED=1\n", stderr)
        return
    }
    let path = "/tmp/proflow-browser-harness-\(suffix)-\(Int(Date().timeIntervalSince1970)).png"
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); p.arguments = ["-x", path]
    try? p.run(); p.waitUntilExit(); fputs("SCREENSHOT=\(path)\n", stderr)
}

func finish(_ result: String) {
    if mayActivateChrome, let previousFrontmost, previousFrontmost.bundleIdentifier != "com.google.Chrome" {
        previousFrontmost.activate(options: [.activateIgnoringOtherApps])
    }
    print("BROWSER_UI_RESULT=\(result)")
    print(String(format: "BROWSER_UI_SECONDS=%.3f", Date().timeIntervalSince(started)))
}

func dismissChromeHelpIfPresent() throws {
    let names: Set<String> = ["关闭帮助气泡", "稍后提醒我", "Close help bubble", "Remind me later"]
    guard let target = button(named: names) else { return }
    try click(target)
    guard wait(3.0, { button(named: names) == nil }) else {
        throw NSError(domain: "human-e2e", code: 12, userInfo: [NSLocalizedDescriptionKey: "CHROME_HELP_BUBBLE_STILL_VISIBLE"])
    }
}

func tasksPageVisible() -> Bool {
    nodes().contains { text($0).contains("ProFlow Tasks") }
}

func field(role expectedRole: String, named name: String) -> AXUIElement? {
    nodes().first { role($0) == expectedRole && text($0).hasPrefix(name) }
}

func pasteText(_ value: String, into element: AXUIElement) throws {
    try click(element)
    key(0, flags: [.maskCommand])
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setString(value, forType: .string) else {
        throw NSError(domain: "human-e2e", code: 16, userInfo: [NSLocalizedDescriptionKey: "CLIPBOARD_WRITE_FAILED"])
    }
    key(9, flags: [.maskCommand])
    guard wait(2.0, { stringAttribute(element, kAXValueAttribute as CFString) == value }) else {
        throw NSError(domain: "human-e2e", code: 17, userInfo: [NSLocalizedDescriptionKey: "FIELD_VALUE_READBACK_MISMATCH"])
    }
}

func createReal3Task() throws {
    try openProFlowTasksPage()
    let environment = ProcessInfo.processInfo.environment
    let title = environment["PROFLOW_REAL3_TASK_TITLE"] ?? "Real-3 read-only smoke"
    let objective = environment["PROFLOW_REAL3_TASK_OBJECTIVE"] ?? "Read repos/proflow/package.json with Execution, report the package name and version, then have Test/Ops independently verify the same values. Do not modify any files."
    guard let titleField = field(role: kAXTextFieldRole as String, named: "Title"),
          let objectiveField = field(role: kAXTextAreaRole as String, named: "Objective") else {
        throw NSError(domain: "human-e2e", code: 18, userInfo: [NSLocalizedDescriptionKey: "NEW_TASK_FIELDS_NOT_FOUND"])
    }
    try pasteText(title, into: titleField)
    try pasteText(objective, into: objectiveField)
    guard let submit = button(named: ["New Task + 3 Workers"]) else {
        throw NSError(domain: "human-e2e", code: 19, userInfo: [NSLocalizedDescriptionKey: "NEW_TASK_BUTTON_NOT_FOUND"])
    }
    try click(submit)
    guard wait(30.0, { nodes().contains { text($0).contains("Created ") } }) else {
        throw NSError(domain: "human-e2e", code: 20, userInfo: [NSLocalizedDescriptionKey: "NEW_TASK_RESULT_NOT_VISIBLE"])
    }
}

func recoverReal3Workers() throws {
    try openProFlowTasksPage()
    let environment = ProcessInfo.processInfo.environment
    let title = environment["PROFLOW_REAL3_TASK_TITLE"] ?? "Real-3 read-only smoke"
    let taskId = environment["PROFLOW_REAL3_TASK_ID"] ?? "task-a6f859c00b1accd027d53d48"
    guard let task = nodes().first(where: {
        role($0) == kAXButtonRole as String && text($0).contains(title)
    }) else {
        throw NSError(domain: "human-e2e", code: 21, userInfo: [NSLocalizedDescriptionKey: "REAL3_TASK_BUTTON_NOT_FOUND"])
    }
    try click(task)
    guard wait(5.0, { nodes().contains { text($0).contains(taskId) } }) else {
        throw NSError(domain: "human-e2e", code: 22, userInfo: [NSLocalizedDescriptionKey: "REAL3_TASK_SELECTION_NOT_CONFIRMED"])
    }
    guard wait(5.0, {
        guard let recover = button(named: ["Recover missing Workers"]) else { return false }
        return enabled(recover)
    }), let recover = button(named: ["Recover missing Workers"]) else {
        throw NSError(domain: "human-e2e", code: 23, userInfo: [NSLocalizedDescriptionKey: "RECOVER_WORKERS_BUTTON_NOT_READY"])
    }
    try click(recover)
}

func openProFlowTasksPage() throws {
    // This action is semantic, not merely navigational: the Extension mints/refreshes
    // the loopback Tasks web session on every click. An already-visible Tasks page
    // must therefore never short-circuit the real Extension action.
    if pressable(named: [extensionName]) == nil {
        guard let extensions = popUpButton(named: ["扩展程序", "Extensions"]) else {
            throw NSError(domain: "human-e2e", code: 13, userInfo: [NSLocalizedDescriptionKey: "EXTENSIONS_MENU_BUTTON_NOT_FOUND"])
        }
        try click(extensions)
        guard wait(3.0, { pressable(named: [extensionName]) != nil }) else {
            throw NSError(domain: "human-e2e", code: 14, userInfo: [NSLocalizedDescriptionKey: "PROFLOW_EXTENSION_MENU_ITEM_NOT_FOUND"])
        }
    }
    guard let proflow = pressable(named: [extensionName]) else {
        throw NSError(domain: "human-e2e", code: 14, userInfo: [NSLocalizedDescriptionKey: "PROFLOW_EXTENSION_MENU_ITEM_NOT_FOUND"])
    }
    try click(proflow)
    guard wait(12.0, tasksPageVisible) else {
        throw NSError(domain: "human-e2e", code: 15, userInfo: [NSLocalizedDescriptionKey: "PROFLOW_TASK_PAGE_NOT_VISIBLE"])
    }
}

func drag(_ source: AXUIElement, to destination: AXUIElement) throws {
    guard let sourceRect = bounds(source), let destinationRect = bounds(destination) else {
        throw NSError(domain: "human-e2e", code: 26, userInfo: [NSLocalizedDescriptionKey: "DRAG_BOUNDS_MISSING"])
    }
    let from = CGPoint(x: sourceRect.midX, y: sourceRect.midY)
    let to = CGPoint(x: destinationRect.midX, y: destinationRect.midY)
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(180_000)
    for step in 1...8 {
        let t = CGFloat(step) / 8.0
        let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(45_000)
    }
    CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func playwrightGroup() -> AXUIElement? {
    nodes().first { role($0) == kAXTabGroupRole as String && text($0).localizedCaseInsensitiveContains("Playwright") }
}

func tab(named title: String, alreadyGrouped: Bool? = nil) -> AXUIElement? {
    nodes().first { element in
        guard role(element) == kAXRadioButtonRole as String else { return false }
        let value = text(element)
        guard value.hasPrefix(title) else { return false }
        if let alreadyGrouped {
            let grouped = value.localizedCaseInsensitiveContains("Playwright") && (value.contains("群组") || value.localizedCaseInsensitiveContains("group"))
            return grouped == alreadyGrouped
        }
        return true
    }
}

func selectExistingTab() throws {
    let title = ProcessInfo.processInfo.environment["PROFLOW_PLAYWRIGHT_TARGET_TITLE"] ?? "ProFlow Tasks"
    guard let target = tab(named: title) else {
        throw NSError(domain: "human-e2e", code: 30, userInfo: [NSLocalizedDescriptionKey: "TAB_TARGET_NOT_FOUND"])
    }
    try click(target)
    usleep(350_000)
}

func attachTabToPlaywrightGroup() throws {
    let title = ProcessInfo.processInfo.environment["PROFLOW_PLAYWRIGHT_TARGET_TITLE"] ?? "ProFlow Tasks"
    if tab(named: title, alreadyGrouped: true) != nil { return }
    guard let target = tab(named: title, alreadyGrouped: false) else {
        throw NSError(domain: "human-e2e", code: 27, userInfo: [NSLocalizedDescriptionKey: "PLAYWRIGHT_TARGET_TAB_NOT_FOUND"])
    }
    guard let group = playwrightGroup() else {
        throw NSError(domain: "human-e2e", code: 28, userInfo: [NSLocalizedDescriptionKey: "PLAYWRIGHT_TAB_GROUP_NOT_FOUND"])
    }
    try drag(target, to: group)
    guard wait(5.0, { tab(named: title, alreadyGrouped: true) != nil }) else {
        throw NSError(domain: "human-e2e", code: 29, userInfo: [NSLocalizedDescriptionKey: "PLAYWRIGHT_TAB_ATTACH_NOT_CONFIRMED"])
    }
}

func inspectTabStrip() {
    for element in nodes() {
        guard let rect = bounds(element), rect.minY < 140 else { continue }
        let value = text(element).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { continue }
        let compact = value.replacingOccurrences(of: "\n", with: " ").prefix(240)
        print("AX_TABSTRIP role=\(role(element)) text=\(compact) bounds=\(Int(rect.minX)),\(Int(rect.minY)),\(Int(rect.width)),\(Int(rect.height))")
    }
}

func inspectFocusedWindow() {
    for element in nodes() {
        let value = text(element).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { continue }
        let kind = role(element)
        guard [kAXButtonRole as String, kAXPopUpButtonRole as String, kAXTextFieldRole as String, kAXTextAreaRole as String, kAXStaticTextRole as String, kAXGroupRole as String].contains(kind) else { continue }
        let compact = value.replacingOccurrences(of: "\n", with: " ").prefix(240)
        print("AX_NODE role=\(kind) text=\(compact)")
    }
}

do {
    switch action {
    case "dismiss-help":
        try dismissChromeHelpIfPresent()
        finish("HELP_DISMISSED")
    case "open-extensions-menu":
        guard let extensions = popUpButton(named: ["扩展程序", "Extensions"]) else {
            throw NSError(domain: "human-e2e", code: 13, userInfo: [NSLocalizedDescriptionKey: "EXTENSIONS_MENU_BUTTON_NOT_FOUND"])
        }
        try click(extensions)
        usleep(400_000)
        finish("EXTENSIONS_MENU_OPENED")
    case "open-proflow-tasks":
        try openProFlowTasksPage()
        finish("PROFLOW_TASK_PAGE_OPENED")
    case "create-real3-task", "recover-real3-workers":
        throw NSError(domain: "human-e2e", code: 25, userInfo: [NSLocalizedDescriptionKey: "TASK_PAGE_USE_PLAYWRIGHT"])
    case "inspect":
        inspectFocusedWindow()
        finish("INSPECTED")
    case "inspect-tab-strip":
        inspectTabStrip()
        finish("TAB_STRIP_INSPECTED")
    case "select-tab":
        try selectExistingTab()
        finish("TAB_SELECTED")
    case "attach-tab-to-playwright-group":
        try attachTabToPlaywrightGroup()
        finish("PLAYWRIGHT_TAB_ATTACHED")
    case "status":
        try ensureExtensionsPage()
        finish(extensionPresent() ? "PRESENT" : "MISSING")
    case "reload":
        try ensureExtensionsPage()
        guard let reload = reloadButtonAfterExtension() else {
            throw NSError(domain: "human-e2e", code: 24, userInfo: [NSLocalizedDescriptionKey: "RELOAD_BUTTON_NOT_FOUND"])
        }
        try click(reload)
        usleep(750_000)
        finish("RELOADED")
    case "uninstall":
        try ensureExtensionsPage()
        if !extensionPresent() { finish("ALREADY_MISSING"); exit(0) }
        guard let remove = removeButtonAfterExtension() else { throw NSError(domain: "human-e2e", code: 2, userInfo: [NSLocalizedDescriptionKey: "REMOVE_BUTTON_NOT_FOUND"]) }
        try click(remove)
        guard wait(3.0, confirmationVisible) else { throw NSError(domain: "human-e2e", code: 3, userInfo: [NSLocalizedDescriptionKey: "REMOVE_CONFIRMATION_NOT_VISIBLE"]) }
        key(36)
        guard wait(8.0, { !extensionPresent() }) else { throw NSError(domain: "human-e2e", code: 4, userInfo: [NSLocalizedDescriptionKey: "EXTENSION_STILL_PRESENT_AFTER_REMOVE"]) }
        finish("UNINSTALLED")
    case "install":
        try ensureExtensionsPage()
        if extensionPresent() { finish("ALREADY_PRESENT"); exit(0) }
        for _ in 0..<4 {
            if !goToFolderVisible() && !pickerVisible() { break }
            key(53)
            usleep(250_000)
        }
        guard wait(3.0, { !goToFolderVisible() && !pickerVisible() }) else { throw NSError(domain: "human-e2e", code: 5, userInfo: [NSLocalizedDescriptionKey: "STALE_PICKER_NOT_CLOSED"]) }
        guard let load = button(named: ["加载未打包的扩展程序", "Load unpacked"]) else { throw NSError(domain: "human-e2e", code: 6, userInfo: [NSLocalizedDescriptionKey: "LOAD_UNPACKED_NOT_FOUND"]) }
        try click(load)
        guard wait(5.0, pickerVisible) else { throw NSError(domain: "human-e2e", code: 7, userInfo: [NSLocalizedDescriptionKey: "DIRECTORY_PICKER_NOT_VISIBLE"]) }
        key(5, flags: [.maskCommand, .maskShift])
        guard wait(3.0, goToFolderVisible) else { throw NSError(domain: "human-e2e", code: 8, userInfo: [NSLocalizedDescriptionKey: "GO_TO_FOLDER_SHEET_NOT_VISIBLE"]) }
        key(9, flags: [.maskCommand])
        usleep(150_000)
        key(36)
        guard wait(5.0, { !goToFolderVisible() && pickerVisible() }) else { throw NSError(domain: "human-e2e", code: 9, userInfo: [NSLocalizedDescriptionKey: "LOAD_DIRECTORY_NOT_READY"]) }
        usleep(250_000)
        key(36)
        guard wait(12.0, extensionPresent) else { throw NSError(domain: "human-e2e", code: 11, userInfo: [NSLocalizedDescriptionKey: "EXTENSION_CARD_NOT_VISIBLE_AFTER_SELECT"]) }
        finish("INSTALLED")
    default:
        fputs("Usage: swift scripts/human-e2e/browser-extension-ui.swift status|reload|install|uninstall|dismiss-help|open-extensions-menu|open-proflow-tasks|create-real3-task|recover-real3-workers|inspect|inspect-tab-strip|select-tab|attach-tab-to-playwright-group\n", stderr)
        exit(64)
    }
} catch {
    screenshot(action)
    fputs("BROWSER_UI_ERROR=\(error.localizedDescription)\n", stderr)
    finish("FAILED")
    exit(1)
}
