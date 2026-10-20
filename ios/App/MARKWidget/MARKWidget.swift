import WidgetKit
import SwiftUI

private let mint = Color(red: 0.42, green: 0.83, blue: 0.64)
private let surface = Color(red: 0.07, green: 0.09, blue: 0.10)
struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    var day: WidgetDay? { snapshot.day(at: date) }
}
struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { sample() }
    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(context.isPreview ? sample() : TodayEntry(date: Date(), snapshot: WidgetStore.read()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let snapshot = WidgetStore.read(), now = Date()
        var cal = Calendar(identifier: .gregorian); cal.timeZone = snapshot.zone
        var dates = [now]
        // Advance the nearest task while MARK is closed and change the day at midnight.
        for n in 1...32 { dates.append(now.addingTimeInterval(Double(n) * 15 * 60)) }
        for n in 1...8 { if let day = cal.date(byAdding: .day, value: n, to: cal.startOfDay(for: now)) { dates.append(day) } }
        let entries = Array(Set(dates)).sorted().map { TodayEntry(date: $0, snapshot: snapshot) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(60 * 60))))
    }
    private func sample() -> TodayEntry {
        let now = Date(); let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        let day = WidgetDay(date: f.string(from: now), total: 4, done: 1, tasks: [
            WidgetTask(id: "preview-1", title: "Созвон с командой", time: "16:00", deadline: false, label: "16:00"),
            WidgetTask(id: "preview-2", title: "Подготовить презентацию", time: nil, deadline: false, label: "Без времени"),
            WidgetTask(id: "preview-3", title: "Отправить документы", time: "18:30", deadline: true, label: "до 18:30")])
        return TodayEntry(date: now, snapshot: WidgetSnapshot(version: 1, userId: "preview", timezone: TimeZone.current.identifier, updatedAt: "", days: [day]))
    }
}
struct TodayView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    private var small: Bool { family == .systemSmall }
    private var nearest: WidgetTask? { entry.day?.nearest(at: entry.date, timezone: entry.snapshot.zone) }
    var body: some View {
        Group {
            if #available(iOS 16.0, *), family == .accessoryCircular || family == .accessoryRectangular || family == .accessoryInline {
                LockScreenView(entry: entry, family: family)
            } else { home }
        }
        .widgetURL(entry.snapshot.url(task: linkedTask))
        .privacySensitive()
    }
    private var linkedTask: WidgetTask? {
        if small { return nearest }
        if #available(iOS 16.0, *), family == .accessoryRectangular || family == .accessoryInline { return nearest }
        return nil
    }
    private var home: some View {
        VStack(alignment: .leading, spacing: small ? 10 : 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Сегодня").font(.system(size: small ? 17 : 18, weight: .bold))
                Spacer(minLength: 4)
                Text("MARK").font(.system(size: 10, weight: .bold)).tracking(1).foregroundColor(mint)
            }
            if let day = entry.day {
                if day.tasks.isEmpty {
                    Spacer(minLength: 0)
                    Image(systemName: day.total > 0 ? "checkmark.circle.fill" : "sun.max").font(.title2).foregroundColor(mint)
                    Text(day.total > 0 ? "Всё выполнено" : "Свободный день").font(.system(size: 15, weight: .semibold))
                    Spacer(minLength: 0)
                } else if small, let task = nearest {
                    Text(task.label).font(.system(size: 12, weight: .semibold)).foregroundColor(task.deadline ? .orange : mint)
                    Text(task.title).font(.system(size: 15, weight: .semibold)).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(day.tasks.prefix(3))) { task in
                        Link(destination: entry.snapshot.url(task: task)) {
                            HStack(spacing: 8) {
                                Circle().stroke(mint.opacity(0.65), lineWidth: 1.5).frame(width: 13, height: 13)
                                Text(task.title).font(.system(size: 14, weight: .medium)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                Text(task.time == nil ? "" : task.label).font(.system(size: 12, weight: .medium)).foregroundColor(task.deadline ? .orange : mint)
                            }.frame(minHeight: 22)
                        }
                    }
                    Spacer(minLength: 0)
                }
                HStack {
                    Text("\(day.done) из \(day.total) выполнено").font(.system(size: 11)).foregroundColor(.white.opacity(0.55))
                    if !small, day.total - day.done > 3 { Spacer(); Text("ещё \(day.total - day.done - 3)").font(.system(size: 11)).foregroundColor(mint) }
                }
            } else {
                Spacer(minLength: 0)
                Image(systemName: "checklist").font(.title2).foregroundColor(mint)
                Text(entry.snapshot.userId == nil ? "Войдите в MARK" : "Откройте MARK").font(.system(size: 15, weight: .semibold))
                Text(entry.snapshot.userId == nil ? "Ваши задачи появятся здесь" : "Чтобы обновить задачи").font(.system(size: 11)).foregroundColor(.white.opacity(0.55))
                Spacer(minLength: 0)
            }
        }
        .foregroundColor(.white)

    }
}
@available(iOS 16.0, *)
struct LockScreenView: View {
    let entry: TodayEntry
    let family: WidgetFamily
    private var remaining: Int { max(0, (entry.day?.total ?? 0) - (entry.day?.done ?? 0)) }
    private var task: WidgetTask? { entry.day?.nearest(at: entry.date, timezone: entry.snapshot.zone) }
    private var emptyTitle: String { entry.day == nil ? "Откройте MARK" : entry.day!.total > 0 ? "Всё выполнено" : "Свободный день" }
    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    if entry.day == nil {
                        Image(systemName: "checklist").font(.system(size: 22))
                        Text("MARK").font(.system(size: 9, weight: .semibold))
                    } else if remaining == 0 {
                        Image(systemName: entry.day!.total > 0 ? "checkmark" : "sun.max").font(.system(size: 23, weight: .semibold))
                    } else {
                        Text("\(remaining)").font(.system(size: 24, weight: .bold)).minimumScaleFactor(0.6)
                        Text("осталось").font(.system(size: 9, weight: .medium))
                    }
                }
            }.accessibilityLabel(entry.day == nil ? "Откройте MARK" : "Сегодня осталось задач: \(remaining)")
        case .accessoryInline:
            if let task { Label("\(task.label) · \(task.title)", systemImage: "checklist").lineLimit(1) }
            else { Label(emptyTitle, systemImage: "checklist").lineLimit(1) }
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(task.map { "Сегодня · \($0.label)" } ?? "Сегодня · MARK").font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Text(task?.title ?? emptyTitle).font(.system(size: 14, weight: .semibold)).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// Keep the Lock Screen's own margins; Home Screen widgets on iOS 15/16 need a surface.
struct MARKWidgetSurface<Content: View>: View {
    @Environment(\.widgetFamily) var family
    let content: Content
    var body: some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(surface, for: .widget)
        } else if #available(iOS 16.0, *), family == .accessoryRectangular || family == .accessoryCircular || family == .accessoryInline {
            content
        } else {
            content.padding(16).background(surface)
        }
    }
}

struct MARKWidget: Widget {
    let kind = WidgetStore.kind
    private var families: [WidgetFamily] {
        if #available(iOS 16.0, *) { return [.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline] }
        return [.systemSmall, .systemMedium]
    }
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            MARKWidgetSurface(content: TodayView(entry: entry))
        }
        .configurationDisplayName("Сегодня в MARK")
        .description("Задачи на главном экране и экране блокировки.")
        .supportedFamilies(families)
    }
}
