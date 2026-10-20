import Foundation
let date = ISO8601DateFormatter().date(from: "2026-10-09T12:00:00Z")!
let zone = TimeZone(identifier: "Europe/Moscow")!
let past = WidgetTask(id: "past", title: "Утро", time: "09:00", deadline: false, label: "09:00")
let future = WidgetTask(id: "future", title: "Встреча", time: "16:00", deadline: false, label: "16:00")
let untimed = WidgetTask(id: "untimed", title: "Документы", time: nil, deadline: false, label: "Без времени")
let day = WidgetDay(date: "2026-10-09", total: 4, done: 1, tasks: [past, future, untimed])
assert(day.nearest(at: date, timezone: zone)?.id == "future")
assert(day.nearest(at: date.addingTimeInterval(4 * 3600), timezone: zone)?.id == "untimed")
let snapshot = WidgetSnapshot(version: 1, userId: "alice", timezone: "Europe/Moscow", updatedAt: "", days: [day])
assert(snapshot.day(at: date)?.total == 4)
assert(snapshot.day(at: date.addingTimeInterval(10 * 3600)) == nil)
let url = snapshot.url(task: future)
assert(url.scheme == "mark" && url.host == "widget")
let items = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
assert(items.first(where: { $0.name == "user" })?.value == "alice")
assert(items.first(where: { $0.name == "task" })?.value == "future")
let decoded = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(snapshot))
assert(decoded.days[0].tasks[1].title == "Встреча")
assert(WidgetSnapshot.empty.userId == nil && WidgetSnapshot.empty.days.isEmpty)
let assistantItems = URLComponents(url: snapshot.assistantURL(), resolvingAgainstBaseURL: false)!.queryItems!
assert(assistantItems.first(where: { $0.name == "screen" })?.value == "assistant")
assert(assistantItems.first(where: { $0.name == "user" })?.value == "alice")
assert(!assistantItems.contains { $0.name == "task" })
print("11 Swift widget model checks passed")
