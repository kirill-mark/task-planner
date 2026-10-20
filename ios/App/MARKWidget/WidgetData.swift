import Foundation

struct WidgetTask: Codable, Identifiable {
    let id: String
    let title: String
    let time: String?
    let deadline: Bool
    let label: String
}
struct WidgetDay: Codable {
    let date: String
    let total: Int
    let done: Int
    let tasks: [WidgetTask]
    func nearest(at date: Date, timezone: TimeZone) -> WidgetTask? {
        let f = DateFormatter(); f.timeZone = timezone; f.dateFormat = "HH:mm"
        let time = f.string(from: date)
        return tasks.filter { $0.time != nil && $0.time! >= time }.sorted { $0.time! < $1.time! }.first
            ?? tasks.first(where: { $0.time == nil }) ?? tasks.first
    }
}
struct WidgetSnapshot: Codable {
    let version: Int
    let userId: String?
    let timezone: String
    let updatedAt: String
    let days: [WidgetDay]
    var zone: TimeZone { TimeZone(identifier: timezone) ?? .current }
    func day(at date: Date) -> WidgetDay? {
        let f = DateFormatter(); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"
        return days.first { $0.date == f.string(from: date) }
    }
    func url(task: WidgetTask? = nil) -> URL {
        var c = URLComponents(); c.scheme = "mark"; c.host = "widget"
        c.queryItems = [URLQueryItem(name: "user", value: userId)]
        if let task { c.queryItems?.append(URLQueryItem(name: "task", value: task.id)) }
        return c.url!
    }
    func assistantURL() -> URL {
        var c = URLComponents(url: url(), resolvingAgainstBaseURL: false)!
        c.queryItems?.append(URLQueryItem(name: "screen", value: "assistant"))
        return c.url!
    }
    static var empty: WidgetSnapshot { WidgetSnapshot(version: 1, userId: nil, timezone: "UTC", updatedAt: "", days: []) }
}

#if os(iOS)
enum WidgetStore {
    static let group = "group.com.kinomark.mark"
    static let kind = "MARKWidget"
    static func fileURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("today-widget.json")
    }
    static func read() -> WidgetSnapshot {
        guard let url = fileURL(), let data = try? Data(contentsOf: url),
              let value = try? JSONDecoder().decode(WidgetSnapshot.self, from: data), value.version == 1 else { return .empty }
        return value
    }
    static func write(_ data: Data) throws {
        guard let url = fileURL() else { throw NSError(domain: "MARKWidget", code: 1, userInfo: [NSLocalizedDescriptionKey: "App Group unavailable"]) }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
#endif
