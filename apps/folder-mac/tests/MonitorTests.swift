import Foundation

@main
struct MonitorTests {
    static func main() throws {
        let origin = URL(string: "http://127.0.0.1:3000")!
        let alias = URL(string: "http://localhost:3000")!
        precondition(FolderLink.trusted(alias, configuredOrigin: origin))
        precondition(!FolderLink.trusted(URL(string: "https://example.com")!, configuredOrigin: origin))
        precondition(!FolderLink.trusted(URL(string: "http://127.0.0.1:8018")!, configuredOrigin: origin))

        let manager = FileManager.default
        let root = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? manager.removeItem(at: root) }
        let shipment = root.appendingPathComponent("Shipment 47", isDirectory: true)
        try manager.createDirectory(at: shipment, withIntermediateDirectories: true)
        let bill = shipment.appendingPathComponent("bill.pdf")
        let previous = Data("sample bill".utf8)
        try previous.write(to: bill)
        try previous.write(to: root.appendingPathComponent("outside.pdf"))
        try previous.write(to: shipment.appendingPathComponent("~$temporary.xlsx"))
        try manager.createSymbolicLink(at: shipment.appendingPathComponent("alias.pdf"), withDestinationURL: bill)
        let discovered = try shipmentFiles(root)
        precondition(discovered.map(\.path) == ["Shipment 47/bill.pdf"])
        let content = try stableContents(root, file: discovered[0], limit: 8192)
        precondition(content == previous)
        try Data("revised bill of lading".utf8).write(to: bill)
        let changed = try stableContents(root, file: discovered[0], limit: 8192)
        precondition(changed == nil)
        print("Native scanner checks passed.")
    }
}
