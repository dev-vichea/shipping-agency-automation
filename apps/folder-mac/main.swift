import AppKit
import ServiceManagement

@MainActor
final class HarborwayApp: NSObject, NSApplicationDelegate {
    private let origin: URL
    private let monitor: FolderMonitor
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let summary = NSMenuItem(title: "Harborway Folder Intake", action: nil, keyEquivalent: "")
    private let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
    private var timer: Timer?
    private var choosing = false

    init(origin: URL) {
        self.origin = origin
        self.monitor = FolderMonitor(origin: origin)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.image = NSImage(systemSymbolName: "folder.badge.gearshape",
                                    accessibilityDescription: "Harborway Folder Intake")
        item.button?.toolTip = "Harborway Folder Intake"
        let menu = NSMenu()
        menu.addItem(summary)
        menu.addItem(.separator())
        add("Open Harborway", action: #selector(openHarborway), to: menu)
        login.target = self
        menu.addItem(login)
        updateLogin()
        menu.addItem(.separator())
        add("Quit Harborway Folder Intake", action: #selector(quit), to: menu)
        item.menu = menu
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.scan() }
        }
        Task { await scan() }
    }

    private func add(_ title: String, action: Selector, to menu: NSMenu) {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
        entry.target = self
        menu.addItem(entry)
    }

    private func scan() async {
        let count = await monitor.scan()
        summary.title = count == 0 ? "No folders connected" : "\(count) connected \(count == 1 ? "folder" : "folders")"
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard !choosing, let url = urls.first else { return }
        guard let link = FolderLink(url, configuredOrigin: origin) else {
            show("Folder setup link unavailable", detail: "Open Integrations at \(origin.absoluteString) and choose the folder from there.")
            return
        }
        choosing = true
        let picker = NSOpenPanel()
        picker.title = "Choose a folder for Harborway"
        picker.message = "Choose the folder containing your shipment subfolders."
        picker.prompt = "Watch Folder"
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.allowsMultipleSelection = false
        picker.canCreateDirectories = false
        activate()
        picker.begin { [weak self] response in
            guard let self else { return }
            guard response == .OK, let selected = picker.url else {
                self.choosing = false
                return
            }
            Task { @MainActor in
                defer { self.choosing = false }
                do {
                    try await self.monitor.connect(link, root: selected)
                    await self.scan()
                } catch {
                    let detail = (error as? FolderError)?.errorDescription ?? FolderError.unavailable.errorDescription
                    self.show("Could not connect folder", detail: detail ?? "")
                }
            }
        }
    }

    private func activate() {
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func show(_ title: String, detail: String) {
        activate()
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.runModal()
    }

    @objc private func openHarborway() {
        NSWorkspace.shared.open(origin.appendingPathComponent("integrations"))
    }

    private func updateLogin() {
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    @objc private func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else if SMAppService.mainApp.status == .requiresApproval {
                SMAppService.openSystemSettingsLoginItems()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            show("Could not change Open at Login", detail: "You can manage login items in Mac System Settings.")
        }
        updateLogin()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let address = Bundle.main.object(forInfoDictionaryKey: "HarborwayWebOrigin") as? String ?? "http://127.0.0.1:3000"
    guard let origin = URL(string: address), FolderLink.trusted(origin, configuredOrigin: origin) else {
        fatalError("Invalid Harborway server")
    }
    app.setActivationPolicy(.accessory)
    let delegate = HarborwayApp(origin: origin)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
}
