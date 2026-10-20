//
//  MARKWidgetBundle.swift
//  MARKWidget
//
//  Created by Кирилл Марченко on 09.10.2026.
//

import WidgetKit
import SwiftUI

@main
struct MARKWidgetBundle: WidgetBundle {
    var body: some Widget {
        MARKWidget()
        DayPlanWidget()
        AssistantWidget()
    }
}
