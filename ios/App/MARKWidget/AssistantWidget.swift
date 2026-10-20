import SwiftUI
import WidgetKit

struct AssistantShortcutView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    var body: some View {
        Group {
            if #available(iOS 16.0, *), family == .accessoryCircular {
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 3) {
                        Image(systemName: "sparkles").font(.system(size: 23, weight: .semibold))
                        Text("MARK").font(.system(size: 9, weight: .bold))
                    }
                }
            } else if #available(iOS 16.0, *), family == .accessoryInline {
                Label("Помощник MARK", systemImage: "sparkles")
            } else {
                HStack(spacing: 9) {
                    Image(systemName: "sparkles").font(.system(size: 24, weight: .medium))
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Помощник MARK").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        Text("С чего начать сегодня?").font(.system(size: 12)).lineLimit(2)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .widgetURL(entry.snapshot.assistantURL())
        .accessibilityLabel("Открыть помощника MARK")
    }
}
struct AssistantWidget: Widget {
    let kind = "MARKAssistant"
    private var families: [WidgetFamily] {
        if #available(iOS 16.0, *) { return [.accessoryCircular, .accessoryRectangular, .accessoryInline] }
        return [.systemSmall]
    }
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            MARKWidgetSurface(content: AssistantShortcutView(entry: entry))
        }
        .configurationDisplayName("Помощник MARK")
        .description("Открой чат и разберись, с чего начать день.")
        .supportedFamilies(families)
    }
}
