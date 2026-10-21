import WidgetKit
import SwiftUI

private let planMint = Color(red: 0.42, green: 0.83, blue: 0.64)

struct DayPlanView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    private var remaining: Int { max(0, (entry.day?.total ?? 0) - (entry.day?.done ?? 0)) }
    private var emptyTitle: String {
        guard let day = entry.day else { return entry.snapshot.userId == nil ? "Войдите в Mark" : "Откройте Mark" }
        return day.total > 0 ? "Всё выполнено" : "Свободный день"
    }
    var body: some View {
        Group {
            if #available(iOS 16.0, *), family == .accessoryRectangular {
                compact
            } else {
                expanded
            }
        }
        .widgetURL(entry.snapshot.url())
        .privacySensitive()
    }
    private var compact: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text("План на день").font(.system(size: 11, weight: .bold))
                Spacer(minLength: 0)
                if remaining > 3 { Text("+\(remaining - 3)").font(.system(size: 10, weight: .medium)) }
            }
            if let day = entry.day, !day.tasks.isEmpty {
                ForEach(Array(day.tasks.prefix(3))) { task in
                    // This list uses one tap target to open the complete Today list.
                    (Text(task.time.map { task.deadline ? "до \($0) " : "\($0) " } ?? "• ")
                        .font(.system(size: 11, weight: .semibold))
                     + Text(task.title).font(.system(size: 12)))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                Text(emptyTitle).font(.system(size: 12, weight: .medium)).lineLimit(2)
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    private var expanded: some View {
        GeometryReader { geometry in
            let limit = max(3, min(7, Int((geometry.size.height - 78) / 34)))
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("План на день").font(.system(size: 21, weight: .bold))
                    Spacer(minLength: 4)
                    Text("Mark").font(.system(size: 11, weight: .bold)).tracking(1).foregroundColor(planMint)
                }
                if let day = entry.day {
                    Text("Осталось \(remaining) · \(day.done) из \(day.total) выполнено")
                        .font(.system(size: 12)).foregroundColor(.white.opacity(0.6)).lineLimit(1)
                    if !day.tasks.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(day.tasks.prefix(limit))) { task in
                                Link(destination: entry.snapshot.url(task: task)) {
                                    HStack(spacing: 10) {
                                        Circle().stroke(planMint.opacity(0.7), lineWidth: 1.5).frame(width: 15, height: 15)
                                        Text(task.title).font(.system(size: 15, weight: .medium))
                                            .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                        if task.time != nil {
                                            Text(task.label).font(.system(size: 12, weight: .semibold))
                                                .foregroundColor(task.deadline ? .orange : planMint)
                                        }
                                    }.frame(minHeight: 24)
                                }
                            }
                        }
                        Spacer(minLength: 0)
                        Link(destination: entry.snapshot.url()) {
                            HStack {
                                Text(remaining > limit ? "Ещё \(remaining - limit) · открыть весь день" : "Открыть весь день")
                                Spacer(minLength: 4)
                                Image(systemName: "arrow.up.right")
                            }.font(.system(size: 12, weight: .medium)).foregroundColor(planMint)
                        }
                    } else {
                        Spacer(minLength: 0)
                        Image(systemName: day.total > 0 ? "checkmark.circle.fill" : "sun.max").font(.system(size: 30)).foregroundColor(planMint)
                        Text(emptyTitle).font(.system(size: 19, weight: .semibold))
                        Text(day.total > 0 ? "План на сегодня закрыт" : "Добавьте задачи в Mark")
                            .font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
                        Spacer(minLength: 0)
                    }
                } else {
                    Spacer(minLength: 0)
                    Image(systemName: "checklist").font(.system(size: 30)).foregroundColor(planMint)
                    Text(emptyTitle).font(.system(size: 19, weight: .semibold))
                    Text("Ваш план появится здесь после открытия Mark")
                        .font(.system(size: 13)).foregroundColor(.white.opacity(0.6))
                    Spacer(minLength: 0)
                }
            }.foregroundColor(.white)
        }
    }
}

struct DayPlanWidget: Widget {
    let kind = "MARKDayPlan"
    private var families: [WidgetFamily] {
        if #available(iOS 16.0, *) { return [.systemLarge, .accessoryRectangular] }
        return [.systemLarge]
    }
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            MARKWidgetSurface(content: DayPlanView(entry: entry))
        }
        .configurationDisplayName("План на день")
        .description("Список задач на сегодня: компактный на экране блокировки и большой на главном экране.")
        .supportedFamilies(families)
    }
}
