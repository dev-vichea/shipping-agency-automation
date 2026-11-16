import CryptoKit
import Darwin
import Foundation

private let supportedFiles = Set(["pdf", "xls", "xlsx"])

struct FolderLink {
    let origin: URL
    let sourceID: UUID
    let code: String

    init?(_ url: URL, configuredOrigin: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "harborway-folder", parts.host == "choose",
              let items = parts.queryItems, items.count == 3,
              let address = items.first(where: { $0.name == "server" })?.value,
              let origin = URL(string: address),
              let id = items.first(where: { $0.name == "source" })?.value.flatMap(UUID.init(uuidString:)),
              let code = items.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              Self.trusted(origin, configuredOrigin: configuredOrigin)
        else { return nil }
        self.origin = origin
        self.sourceID = id
        self.code = code
    }

    static func trusted(_ origin: URL, configuredOrigin: URL) -> Bool {
        let loopback = Set(["localhost", "127.0.0.1"])
        guard let host = origin.host, let approved = configuredOrigin.host,
              origin.user == nil, origin.password == nil,
              origin.path.isEmpty || origin.path == "/",
              origin.query == nil, origin.fragment == nil,
              origin.scheme == configuredOrigin.scheme, origin.port == configuredOrigin.port,
              origin.scheme == "https" || (origin.scheme == "http" && loopback.contains(host))
        else { return false }
        return host == approved || (loopback.contains(host) && loopback.contains(approved))
    }
}

private final class DirectRequests: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum FolderError: LocalizedError {
    case response(Int), unavailable

    var errorDescription: String? {
        switch self {
        case .response(401): return "This setup link expired. Open a new one in Harborway."
        case .unavailable: return "This folder could not be read. Check that it is available on your Mac."
        default: return "Harborway could not finish setup. Try again from Integrations."
        }
    }
}

struct FileVersion: Codable, Equatable {
    let size: Int64
    let seconds: Int
    let nanoseconds: Int

    init(_ info: stat) {
        size = info.st_size
        seconds = info.st_mtimespec.tv_sec
        nanoseconds = info.st_mtimespec.tv_nsec
    }
}

private struct CheckedFile: Codable {
    let version: FileVersion
    var rejected = false
}

private struct FolderSource: Codable {
    let id: UUID
    let origin: URL
    let root: URL
    let key: String
    let folderNamespace: UUID
    var known: [String: CheckedFile]
    var pending: [String: FileVersion] = [:]
}

struct ShipmentFile {
    let group: String
    let name: String
    let version: FileVersion
    var path: String { "\(group)/\(name)" }
}

func shipmentFiles(_ root: URL) throws -> [ShipmentFile] {
    let manager = FileManager.default
    let flags: Set<URLResourceKey> = [.isDirectoryKey, .isSymbolicLinkKey]
    let groups = try manager.contentsOfDirectory(at: root, includingPropertiesForKeys: Array(flags), options: .skipsHiddenFiles)
    var files: [ShipmentFile] = []
    for group in groups.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
        let properties = try group.resourceValues(forKeys: flags)
        guard properties.isDirectory == true, properties.isSymbolicLink == false else { continue }
        let entries = try manager.contentsOfDirectory(at: group, includingPropertiesForKeys: nil, options: .skipsHiddenFiles)
        for entry in entries.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            let name = entry.lastPathComponent
            guard supportedFiles.contains(entry.pathExtension.lowercased()), !name.hasPrefix("~$") else { continue }
            var info = stat()
            guard lstat(entry.path, &info) == 0, info.st_mode & S_IFMT == S_IFREG else { continue }
            files.append(ShipmentFile(group: group.lastPathComponent, name: name, version: FileVersion(info)))
        }
    }
    return files
}

func stableContents(_ root: URL, file: ShipmentFile, limit: Int) throws -> Data? {
    let directoryFlags = O_RDONLY | O_DIRECTORY | O_NOFOLLOW
    let rootFD = open(root.path, directoryFlags)
    guard rootFD >= 0 else { throw FolderError.unavailable }
    defer { close(rootFD) }
    let groupFD = openat(rootFD, file.group, directoryFlags)
    guard groupFD >= 0 else { return nil }
    defer { close(groupFD) }
    let fileFD = openat(groupFD, file.name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    guard fileFD >= 0 else { return nil }
    let handle = FileHandle(fileDescriptor: fileFD, closeOnDealloc: true)
    defer { try? handle.close() }
    var before = stat()
    guard fstat(fileFD, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
          FileVersion(before) == file.version, file.version.size > 0, file.version.size <= limit,
          let data = try handle.read(upToCount: limit + 1)
    else { return nil }
    var after = stat()
    guard fstat(fileFD, &after) == 0, FileVersion(after) == file.version, data.count == file.version.size else { return nil }
    return data
}

actor FolderMonitor {
    private struct Config: Decodable { let enabled: Bool; let max_file_bytes: Int }
    private struct Key: Decodable { let key: String }
    private let storage: URL
    private let allowedOrigin: URL
    private let session: URLSession
    private var running = false
    private var pairing = false

    init(origin: URL, storage: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Harborway/Mac Intake", isDirectory: true)) {
        self.storage = storage
        self.allowedOrigin = origin
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 20
        configuration.httpShouldSetCookies = false
        self.session = URLSession(configuration: configuration, delegate: DirectRequests(), delegateQueue: nil)
    }

    private func request(origin: URL, endpoint: String, key: String? = nil, data: Data? = nil,
                         contentType: String = "application/json") async throws -> Data {
        guard FolderLink.trusted(origin, configuredOrigin: allowedOrigin) else { throw FolderError.unavailable }
        let url = origin.appendingPathComponent("api/v1/integrations/folders/agent/\(endpoint)")
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let key { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        if let data {
            request.httpMethod = "POST"
            request.httpBody = data
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let (body, response) = try await session.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode else { throw FolderError.unavailable }
        guard (200...299).contains(status) else { throw FolderError.response(status) }
        return body
    }

    private func configURL(_ id: UUID) -> URL {
        storage.appendingPathComponent(id.uuidString + ".json")
    }

    private func save(_ source: FolderSource) throws {
        try FileManager.default.createDirectory(at: storage, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: storage.path)
        let path = configURL(source.id)
        try JSONEncoder().encode(source).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }

    func connect(_ link: FolderLink, root: URL) async throws {
        guard !pairing else { throw FolderError.unavailable }
        pairing = true
        defer { pairing = false }
        let root = root.resolvingSymlinksInPath().standardizedFileURL
        let previous = try? JSONDecoder().decode(FolderSource.self, from: Data(contentsOf: configURL(link.sourceID)))
        let sameFolder = previous.flatMap { $0.root == root ? $0 : nil }
        let known = try sameFolder?.known ?? Dictionary(
            uniqueKeysWithValues: shipmentFiles(root).map { ($0.path, CheckedFile(version: $0.version)) }
        )
        let payload = try JSONEncoder().encode(["source_id": link.sourceID.uuidString, "code": link.code])
        let result = try await request(origin: link.origin, endpoint: "pair", data: payload)
        let key = try JSONDecoder().decode(Key.self, from: result).key
        guard key.lowercased().hasPrefix(link.sourceID.uuidString.lowercased() + ".") else { throw FolderError.unavailable }
        try save(FolderSource(id: link.sourceID, origin: link.origin, root: root, key: key,
                              folderNamespace: sameFolder?.folderNamespace ?? UUID(), known: known))
    }

    func scan() async -> Int {
        let files = (try? FileManager.default.contentsOfDirectory(at: storage, includingPropertiesForKeys: nil)) ?? []
        let sources = files.filter { $0.pathExtension == "json" }.compactMap {
            try? JSONDecoder().decode(FolderSource.self, from: Data(contentsOf: $0))
        }
        guard !running, !pairing else { return sources.count }
        running = true
        defer { running = false }
        for source in sources {
            if pairing { break }
            await scan(source)
        }
        return sources.count
    }

    private func scan(_ configured: FolderSource) async {
        var source = configured
        do {
            let data = try await request(origin: source.origin, endpoint: "config", key: source.key)
            let config = try JSONDecoder().decode(Config.self, from: data)
            var status = "ok"
            if config.enabled {
                do {
                    status = await collect(&source, limit: config.max_file_bytes, files: try shipmentFiles(source.root))
                    // A replacement connection can finish while an upload is in flight.
                    let current = try JSONDecoder().decode(FolderSource.self, from: Data(contentsOf: configURL(source.id)))
                    guard current.key == source.key else { return }
                    try save(source)
                } catch {
                    status = "folder_unavailable"
                }
            }
            let body = try JSONEncoder().encode(["status": status])
            _ = try await request(origin: source.origin, endpoint: "check", key: source.key, data: body)
        } catch {
            // A stale check is visible in Harborway. The original files stay on disk.
        }
    }

    private func collect(_ source: inout FolderSource, limit: Int, files: [ShipmentFile]) async -> String {
        var pending: [String: FileVersion] = [:]
        var issue = "ok"
        for file in files {
            if let saved = source.known[file.path], saved.version == file.version {
                if saved.rejected { issue = "file_rejected" }
                continue
            }
            guard file.version.size > 0, source.pending[file.path] == file.version else {
                pending[file.path] = file.version
                if issue == "ok" { issue = "waiting_for_files" }
                continue
            }
            if file.version.size > limit {
                source.known[file.path] = CheckedFile(version: file.version, rejected: true)
                issue = "file_rejected"
                continue
            }
            guard let data = try? stableContents(source.root, file: file, limit: limit) else {
                pending[file.path] = file.version
                if issue == "ok" { issue = "waiting_for_files" }
                continue
            }
            do {
                try await upload(source, file: file, data: data)
                source.known[file.path] = CheckedFile(version: file.version)
            } catch FolderError.response(let status) where [413, 415, 422].contains(status) {
                source.known[file.path] = CheckedFile(version: file.version, rejected: true)
                issue = "file_rejected"
            } catch {
                pending[file.path] = file.version
                issue = "upload_retry"
            }
        }
        source.pending = pending
        return issue
    }

    private func upload(_ source: FolderSource, file: ShipmentFile, data: Data) async throws {
        let boundary = UUID().uuidString
        let prefix = "--\(boundary)\r\nContent-Disposition: form-data; name="
        let normalized = file.group.precomposedStringWithCanonicalMapping
        let group = SHA256.hash(data: Data("\(source.folderNamespace.uuidString):\(normalized)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        let label = String(normalized.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.prefix(200))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let safeName = String(file.name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) })
            .replacingOccurrences(of: "\"", with: "_").replacingOccurrences(of: "\\", with: "_")
        let subject = label.isEmpty ? "Shipment folder" : label
        var body = Data(("""
        \(prefix)"group"\r\n\r\n\(group)\r\n\(prefix)"subject"\r\n\r\n\(subject)\r\n\(prefix)"file"; filename="\(safeName)"\r\nContent-Type: application/octet-stream\r\n\r\n
        """).utf8)
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        _ = try await request(origin: source.origin, endpoint: "upload", key: source.key, data: body,
                              contentType: "multipart/form-data; boundary=\(boundary)")
    }
}
