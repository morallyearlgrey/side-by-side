import Foundation

/// Phone protocol only. The Core2 advertisement prototype has a different namespace.
enum BleProtocol {
  static let serviceUUID = "77E397EF-735A-46F8-93A8-10278179E870"
  static let tokenUUID = "77E397EF-735A-46F8-93A8-10278179E871"
  static let version: UInt8 = 1
  static let tokenLifetime: TimeInterval = 120
  static let peerCooldown: TimeInterval = 30
  static let encounterCooldown: TimeInterval = 45
  static let connectionTimeout: TimeInterval = 10
  static let maxConnections = 4

  static func validToken(_ token: String) -> Bool {
    let bytes = Array(token.utf8)
    guard (32...128).contains(bytes.count) else { return false }
    return bytes.allSatisfy { byte in
      switch byte {
      case 65...90, 97...122, 48...57, 45, 95: return true
      default: return false
      }
    }
  }

  static func encode(_ token: String) -> Data? {
    guard validToken(token) else { return nil }
    return Data([version]) + Data(token.utf8)
  }

  static func decode(_ data: Data) -> String? {
    guard (33...129).contains(data.count), data.first == version,
      let token = String(data: data.dropFirst(), encoding: .utf8), validToken(token)
    else { return nil }
    return token
  }

  static func readSuffix(_ data: Data, offset: Int) -> Data? {
    guard offset >= 0, offset <= data.count else { return nil }
    return Data(data.dropFirst(offset))
  }
}

/// Bounded memory and monotonic time avoid indefinite suppression after clock changes.
struct BleCooldown {
  let interval: TimeInterval
  let capacity: Int
  private var seen: [String: TimeInterval] = [:]

  init(interval: TimeInterval, capacity: Int = 256) {
    self.interval = interval
    self.capacity = capacity
  }

  mutating func accept(_ key: String, now: TimeInterval) -> Bool {
    seen = seen.filter { now >= $0.value && now - $0.value < interval }
    guard seen[key] == nil else { return false }
    if seen.count >= capacity, let oldest = seen.min(by: { $0.value < $1.value }) {
      seen.removeValue(forKey: oldest.key)
    }
    seen[key] = now
    return true
  }

  mutating func reset() { seen.removeAll() }
}
