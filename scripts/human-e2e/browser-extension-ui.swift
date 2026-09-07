import AppKit
import ApplicationServices
import Foundation

let extensionName = ProcessInfo.processInfo.environment["PROFLOW_BROWSER_EXTENSION_NAME"] ?? "ProFlow Execution Browser"
let extensionId = ProcessInfo.processInfo.environment["PROFLOW_BROWSER_EXTENSION_ID"] ?? "eehdadpmjffomabiedcjijiakconalab"
let action = CommandLine.arguments.dropFirst().first(where: { $0 != "--" }) ?? "status"
let started = Date()
let previousFrontmost = NSWorkspace.shared.frontmostApplication
let privilegedActions: Set<String> = [
    "dismiss-help", "open-extensions-menu", "open-proflow-tasks", "inspect-tab-strip",
    "select-tab", "attach-tab-to-playwright-group", "status", "screenshot-extensions",
    "inspect-extension-geometry", "reload-at-point", "reload", "install", "uninstall",
]
let mayActivateChrome = privilegedActions.contains(action)
let targetReloadClickDispatchedResult = "TARGET_RELOAD_CLICK_DISPATCHED"

struct HarnessDecisionError: LocalizedError {
    let code: String
    var errorDescription: String? { code }
}

final class ReloadSemanticNode {
    let key: String
    let roleName: String
    let value: String
    let isEnabled: Bool
    let actionNames: Set<String>
    let rect: CGRect?
    let children: [ReloadSemanticNode]
    let liveElement: AXUIElement?

    init(
        key: String,
        roleName: String,
        value: String,
        isEnabled: Bool = true,
        actionNames: Set<String> = [],
        rect: CGRect? = nil,
        children: [ReloadSemanticNode] = [],
        liveElement: AXUIElement? = nil
    ) {
        self.key = key
        self.roleName = roleName
        self.value = value
        self.isEnabled = isEnabled
        self.actionNames = actionNames
        self.rect = rect
        self.children = children
        self.liveElement = liveElement
    }
}

struct ReloadTargetSelection {
    let card: ReloadSemanticNode
    let reload: ReloadSemanticNode
    let point: CGPoint
}

func flattenSemantic(_ root: ReloadSemanticNode) -> [ReloadSemanticNode] {
    var result: [ReloadSemanticNode] = []
    var stack = [root]
    while let current = stack.popLast() {
        result.append(current)
        stack.append(contentsOf: current.children.reversed())
    }
    return result
}

func textSegments(_ value: String) -> Set<String> {
    Set(value.split(separator: "|").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) })
}

func chromeExtensionIds(in value: String) -> Set<String> {
    let pattern = #"(?<![a-p])[a-p]{32}(?![a-p])"#
    guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return Set(expression.matches(in: value, range: range).compactMap {
        Range($0.range, in: value).map { String(value[$0]) }
    })
}

func rectContains(_ outer: CGRect, _ inner: CGRect) -> Bool {
    outer.contains(CGPoint(x: inner.minX, y: inner.minY)) &&
        outer.contains(CGPoint(x: inner.maxX, y: inner.maxY))
}

func isReloadControl(_ node: ReloadSemanticNode) -> Bool {
    node.roleName == kAXButtonRole as String &&
        !textSegments(node.value).isDisjoint(with: ["Reload", "重新加载"])
}

func isAdjacentMutationControl(_ node: ReloadSemanticNode) -> Bool {
    let segments = textSegments(node.value)
    let namedMutation = !segments.isDisjoint(with: ["Remove", "移除", "Details", "详细信息"])
    let toggleRole = ["AXCheckBox", "AXSwitch"].contains(node.roleName)
    let otherPressableControl = node.actionNames.contains(kAXPressAction as String) &&
        [kAXButtonRole as String, kAXPopUpButtonRole as String, "AXCheckBox", "AXSwitch"].contains(node.roleName)
    return namedMutation || toggleRole || otherPressableControl
}

func validateReloadPoint(
    _ point: CGPoint,
    reloadBounds: CGRect,
    otherControls: [ReloadSemanticNode]
) throws {
    guard reloadBounds.contains(point) else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_POINT_OUTSIDE")
    }
    for control in otherControls {
        guard let controlBounds = control.rect else { continue }
        if controlBounds.contains(point) {
            throw HarnessDecisionError(code: "TARGET_RELOAD_POINT_CONTROL_OVERLAP")
        }
    }
}

func selectReloadTarget(
    root: ReloadSemanticNode,
    extensionName: String,
    extensionId: String
) throws -> ReloadTargetSelection {
    func matchesCardIdentity(_ candidate: ReloadSemanticNode) -> Bool {
        guard let cardBounds = candidate.rect, cardBounds.width > 0, cardBounds.height > 0 else { return false }
        let descendants = flattenSemantic(candidate)
        let nameNodes = descendants.filter { $0.value.contains(extensionName) }
        let ids = descendants.reduce(into: Set<String>()) { result, node in
            result.formUnion(chromeExtensionIds(in: node.value))
        }
        guard !nameNodes.isEmpty, ids == [extensionId] else { return false }
        let idNodes = descendants.filter { chromeExtensionIds(in: $0.value).contains(extensionId) }
        guard !idNodes.isEmpty else { return false }
        let boundedName = nameNodes.contains { node in
            guard let nodeBounds = node.rect else { return false }
            return rectContains(cardBounds, nodeBounds)
        }
        let boundedId = idNodes.contains { node in
            guard let nodeBounds = node.rect else { return false }
            return rectContains(cardBounds, nodeBounds)
        }
        return boundedName && boundedId
    }

    let allCandidates = flattenSemantic(root).filter(matchesCardIdentity)
    let minimalCandidates = allCandidates.filter { candidate in
        !candidate.children.flatMap(flattenSemantic).contains(where: matchesCardIdentity)
    }
    guard minimalCandidates.count == 1 else {
        throw HarnessDecisionError(code: minimalCandidates.isEmpty ? "TARGET_EXTENSION_CARD_NOT_FOUND" : "TARGET_EXTENSION_CARD_NOT_UNIQUE")
    }
    let card = minimalCandidates[0]
    guard let cardBounds = card.rect else {
        throw HarnessDecisionError(code: "TARGET_EXTENSION_CARD_BOUNDS_MISSING")
    }
    let descendants = flattenSemantic(card)
    let reloads = descendants.filter(isReloadControl)
    guard reloads.count == 1 else {
        throw HarnessDecisionError(code: reloads.isEmpty ? "TARGET_RELOAD_NOT_FOUND" : "TARGET_RELOAD_NOT_UNIQUE")
    }
    let reload = reloads[0]
    guard reload.isEnabled else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_DISABLED")
    }
    guard reload.actionNames.contains(kAXPressAction as String) else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_NOT_PRESSABLE")
    }
    guard let reloadBounds = reload.rect, rectContains(cardBounds, reloadBounds) else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_BOUNDS_INVALID")
    }
    let point = CGPoint(x: reloadBounds.midX, y: reloadBounds.midY)
    let otherControls = descendants.filter { $0 !== reload && isAdjacentMutationControl($0) }
    try validateReloadPoint(point, reloadBounds: reloadBounds, otherControls: otherControls)
    return ReloadTargetSelection(card: card, reload: reload, point: point)
}

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

func actions(_ element: AXUIElement) -> Set<String> {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success,
          let values = names as? [String] else { return [] }
    return Set(values)
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

let browserRoot: AXUIElement? = action == "harness-self-test" ? nil : chrome(activate: mayActivateChrome).1
func scanRoot() -> AXUIElement {
    guard let root = browserRoot else { fatalError("BROWSER_ROOT_UNAVAILABLE_FOR_SELF_TEST") }
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
        return actions(element).contains(kAXPressAction as String)
    }
}
func extensionCard() -> AXUIElement? {
    let candidates = nodes().compactMap { element -> (AXUIElement, CGFloat)? in
        let descendants = flatten(element)
        let hasName = descendants.contains { text($0).contains(extensionName) }
        let hasId = descendants.contains { text($0).contains(extensionId) }
        let hasCardAction = descendants.contains {
            guard role($0) == kAXButtonRole as String else { return false }
            let value = text($0)
            return ["重新加载", "Reload", "移除", "Remove"].contains(value)
        }
        guard hasName, hasId, hasCardAction, let rect = bounds(element), rect.width > 0, rect.height > 0 else { return nil }
        return (element, rect.width * rect.height)
    }
    return candidates.min(by: { $0.1 < $1.1 })?.0
}
func cardButton(named names: Set<String>) -> AXUIElement? {
    guard let card = extensionCard() else { return nil }
    return flatten(card).first {
        guard role($0) == kAXButtonRole as String else { return false }
        let title = stringAttribute($0, kAXTitleAttribute as CFString)
        let combined = text($0)
        return names.contains(title) || names.contains(combined)
    }
}
func removeButtonAfterExtension() -> AXUIElement? {
    cardButton(named: ["移除", "Remove"])
}
func semanticSnapshot(_ element: AXUIElement, remaining: inout Int) -> ReloadSemanticNode {
    remaining -= 1
    let semanticChildren = remaining > 0 ? children(element).map { semanticSnapshot($0, remaining: &remaining) } : []
    return ReloadSemanticNode(
        key: String(describing: element),
        roleName: role(element),
        value: text(element),
        isEnabled: enabled(element),
        actionNames: actions(element),
        rect: bounds(element),
        children: semanticChildren,
        liveElement: element
    )
}

func liveReloadTarget() throws -> ReloadTargetSelection {
    var remaining = 5000
    let snapshot = semanticSnapshot(scanRoot(), remaining: &remaining)
    return try selectReloadTarget(root: snapshot, extensionName: extensionName, extensionId: extensionId)
}

func formatRect(_ rect: CGRect) -> String {
    String(format: "x=%.1f,y=%.1f,w=%.1f,h=%.1f", rect.minX, rect.minY, rect.width, rect.height)
}

func emitReloadAttestation(_ selection: ReloadTargetSelection) throws {
    guard let cardBounds = selection.card.rect, let reloadBounds = selection.reload.rect else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_ATTESTATION_BOUNDS_MISSING")
    }
    print("TARGET_EXTENSION_NAME=\(extensionName)")
    print("TARGET_EXTENSION_ID=\(extensionId)")
    print("TARGET_CARD_BOUNDS=\(formatRect(cardBounds))")
    print("TARGET_CARD_UNIQUE=YES")
    print("TARGET_RELOAD_ROLE=\(selection.reload.roleName)")
    print("TARGET_RELOAD_TEXT=\(selection.reload.value)")
    print("TARGET_RELOAD_BOUNDS=\(formatRect(reloadBounds))")
    print(String(format: "TARGET_RELOAD_POINT=x=%.1f,y=%.1f", selection.point.x, selection.point.y))
    print("TARGET_RELOAD_UNIQUE=YES")
    print("TARGET_RELOAD_POINT_INSIDE=YES")
    print("TARGET_RELOAD_POINT_CONTROL_OVERLAP=NO")
    fflush(stdout)
}
func inspectExtensionGeometry() throws {
    try ensureExtensionsPage()
    let all = nodes()
    for element in all {
        let value = text(element)
        let isIdentity = value.contains(extensionName) || value.contains(extensionId)
        let isReload = role(element) == kAXButtonRole as String && ["重新加载", "Reload"].contains(value)
        guard (isIdentity || isReload), let rect = bounds(element) else { continue }
        print("AX_GEOMETRY role=\(role(element)) text=\(value) x=\(rect.origin.x) y=\(rect.origin.y) w=\(rect.size.width) h=\(rect.size.height)")
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
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", path]
    do {
        try process.run()
        let deadline = Date().addingTimeInterval(3.0)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: path) {
                if process.isRunning { process.terminate() }
                fputs("SCREENSHOT=\(path)\n", stderr)
                return
            }
            if !process.isRunning { break }
            usleep(50_000)
        }
        if process.isRunning { process.terminate() }
        if FileManager.default.fileExists(atPath: path) {
            fputs("SCREENSHOT=\(path)\n", stderr)
        } else {
            fputs("SCREENSHOT_FAILED=1\n", stderr)
        }
    } catch {
        fputs("SCREENSHOT_FAILED=1\n", stderr)
    }
}

func dispatchReloadPress(_ selection: ReloadTargetSelection) throws {
    guard let element = selection.reload.liveElement else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_LIVE_ELEMENT_MISSING")
    }
    guard AXUIElementPerformAction(element, kAXPressAction as CFString) == .success else {
        throw HarnessDecisionError(code: "TARGET_RELOAD_PRESS_DISPATCH_FAILED")
    }
}

func runHarnessSelfTests() throws {
    let press = kAXPressAction as String
    let buttonRole = kAXButtonRole as String
    let targetName = "ProFlow Execution Browser"
    let targetId = "eehdadpmjffomabiedcjijiakconalab"
    let otherId = "abcdefghijklmnopabcdefghijklmnop"
    let cardBounds = CGRect(x: 0, y: 0, width: 320, height: 180)
    let reloadBounds = CGRect(x: 250, y: 120, width: 24, height: 24)

    func node(_ key: String, _ role: String, _ value: String, rect: CGRect?, enabled: Bool = true, actions: Set<String> = [], children: [ReloadSemanticNode] = []) -> ReloadSemanticNode {
        ReloadSemanticNode(key: key, roleName: role, value: value, isEnabled: enabled, actionNames: actions, rect: rect, children: children)
    }
    func card(name: String = targetName, id: String = targetId, reloads: [ReloadSemanticNode]? = nil, extras: [ReloadSemanticNode] = []) -> ReloadSemanticNode {
        let defaultReload = node("reload", buttonRole, "Reload", rect: reloadBounds, actions: [press])
        return node("card-\(id)", "AXGroup", "", rect: cardBounds, children: [
            node("name", "AXStaticText", name, rect: CGRect(x: 20, y: 20, width: 180, height: 20)),
            node("id", "AXStaticText", "ID: \(id)", rect: CGRect(x: 20, y: 55, width: 260, height: 20)),
        ] + (reloads ?? [defaultReload]) + extras)
    }
    func root(_ cards: [ReloadSemanticNode]) -> ReloadSemanticNode {
        node("root", "AXGroup", "", rect: CGRect(x: 0, y: 0, width: 900, height: 600), children: cards)
    }
    func expectPass(_ name: String, _ body: () throws -> Void) throws {
        try body()
        print("HARNESS_TEST=\(name) PASS")
    }
    func expectFailure(_ name: String, _ expected: String, _ body: () throws -> Void) throws {
        do {
            try body()
            throw HarnessDecisionError(code: "SELF_TEST_EXPECTED_FAILURE_MISSING_\(name)")
        } catch let error as HarnessDecisionError {
            guard error.code == expected else {
                throw HarnessDecisionError(code: "SELF_TEST_WRONG_FAILURE_\(name)_\(error.code)")
            }
            print("HARNESS_TEST=\(name) PASS")
        }
    }

    try expectPass("matching-name-id-unique-reload") {
        _ = try selectReloadTarget(root: root([card()]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("same-name-wrong-id", "TARGET_EXTENSION_CARD_NOT_FOUND") {
        _ = try selectReloadTarget(root: root([card(id: otherId)]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("name-id-in-different-cards", "TARGET_EXTENSION_CARD_NOT_FOUND") {
        let nameCard = card(id: otherId)
        let idCard = card(name: "Other Extension", id: targetId)
        _ = try selectReloadTarget(root: root([nameCard, idCard]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("duplicate-reload", "TARGET_RELOAD_NOT_UNIQUE") {
        let first = node("reload-1", buttonRole, "Reload", rect: reloadBounds, actions: [press])
        let second = node("reload-2", buttonRole, "重新加载", rect: CGRect(x: 280, y: 120, width: 24, height: 24), actions: [press])
        _ = try selectReloadTarget(root: root([card(reloads: [first, second])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("missing-reload", "TARGET_RELOAD_NOT_FOUND") {
        _ = try selectReloadTarget(root: root([card(reloads: [])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("reload-not-pressable", "TARGET_RELOAD_NOT_PRESSABLE") {
        let reload = node("reload", buttonRole, "Reload", rect: reloadBounds)
        _ = try selectReloadTarget(root: root([card(reloads: [reload])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("reload-disabled", "TARGET_RELOAD_DISABLED") {
        let reload = node("reload", buttonRole, "Reload", rect: reloadBounds, enabled: false, actions: [press])
        _ = try selectReloadTarget(root: root([card(reloads: [reload])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("point-overlaps-toggle", "TARGET_RELOAD_POINT_CONTROL_OVERLAP") {
        let toggle = node("toggle", "AXSwitch", "Enabled", rect: reloadBounds, actions: [press])
        _ = try selectReloadTarget(root: root([card(extras: [toggle])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("point-overlaps-remove", "TARGET_RELOAD_POINT_CONTROL_OVERLAP") {
        let remove = node("remove", buttonRole, "Remove", rect: reloadBounds, actions: [press])
        _ = try selectReloadTarget(root: root([card(extras: [remove])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("point-overlaps-details", "TARGET_RELOAD_POINT_CONTROL_OVERLAP") {
        let details = node("details", buttonRole, "Details", rect: reloadBounds, actions: [press])
        _ = try selectReloadTarget(root: root([card(extras: [details])]), extensionName: targetName, extensionId: targetId)
    }
    try expectFailure("point-outside-reload", "TARGET_RELOAD_POINT_OUTSIDE") {
        try validateReloadPoint(CGPoint(x: 10, y: 10), reloadBounds: reloadBounds, otherControls: [])
    }
    try expectPass("derived-midpoint-and-result-semantics") {
        let selection = try selectReloadTarget(root: root([card()]), extensionName: targetName, extensionId: targetId)
        guard selection.point == CGPoint(x: reloadBounds.midX, y: reloadBounds.midY) else {
            throw HarnessDecisionError(code: "SELF_TEST_DERIVED_POINT_MISMATCH")
        }
        let lower = targetReloadClickDispatchedResult.lowercased()
        guard !lower.contains("adopt"), !lower.contains("version"), !lower.contains("verified"), !lower.contains("reloaded") else {
            throw HarnessDecisionError(code: "SELF_TEST_RESULT_OVERCLAIMS")
        }
    }
    print("HARNESS_TESTS=12/12")
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
    case "harness-self-test":
        try runHarnessSelfTests()
        finish("HARNESS_SELF_TEST_PASS")
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
    case "screenshot-extensions":
        try ensureExtensionsPage()
        screenshot("extensions-current")
        finish(extensionPresent() ? "SCREENSHOT_PRESENT" : "SCREENSHOT_MISSING")
    case "inspect-extension-geometry":
        try inspectExtensionGeometry()
        finish("EXTENSION_GEOMETRY_INSPECTED")
    case "reload-at-point":
        try ensureExtensionsPage()
        let selection = try liveReloadTarget()
        try emitReloadAttestation(selection)
        try dispatchReloadPress(selection)
        usleep(750_000)
        screenshot("reload-at-point-after")
        finish(targetReloadClickDispatchedResult)
    case "reload":
        throw NSError(domain: "human-e2e", code: 29, userInfo: [NSLocalizedDescriptionKey: "RELOAD_REQUIRES_FRESH_POINT"])
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
        fputs("Usage: swift scripts/human-e2e/browser-extension-ui.swift harness-self-test|status|screenshot-extensions|inspect-extension-geometry|reload-at-point|reload|install|uninstall|dismiss-help|open-extensions-menu|open-proflow-tasks|create-real3-task|recover-real3-workers|inspect|inspect-tab-strip|select-tab|attach-tab-to-playwright-group\n", stderr)
        exit(64)
    }
} catch {
    screenshot(action)
    fputs("BROWSER_UI_ERROR=\(error.localizedDescription)\n", stderr)
    finish("FAILED")
    exit(1)
}
