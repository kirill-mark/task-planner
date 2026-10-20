import Foundation
import CoreGraphics
import ImageIO

// Convert the existing MARK artwork to an opaque App Store icon.
// No new artwork is generated here.
guard CommandLine.arguments.count == 3 else { fatalError("Expected source and destination paths") }
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("Unable to decode MARK icon") }
guard let context = CGContext(data: nil, width: 1024, height: 1024,
    bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("Unable to create icon bitmap") }
context.setFillColor(CGColor(red: 0.02, green: 0.31, blue: 0.13, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
context.draw(image, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
guard let output = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(
          URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL, "public.png" as CFString, 1, nil)
      else { fatalError("Unable to create PNG icon") }
CGImageDestinationAddImage(destination, output, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Unable to save PNG icon") }
