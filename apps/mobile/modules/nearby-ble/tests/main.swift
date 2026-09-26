import Foundation

let valid = String(repeating: "A", count: 43)
assert(BleProtocol.decode(BleProtocol.encode(valid)!) == valid)
assert(BleProtocol.encode(String(repeating: "A", count: 31)) == nil)
assert(BleProtocol.encode(String(repeating: "A", count: 129)) == nil)
assert(BleProtocol.encode(valid + "=") == nil)
assert(BleProtocol.encode(valid + "é") == nil)
assert(BleProtocol.decode(Data([2]) + Data(valid.utf8)) == nil)
assert(BleProtocol.decode(Data([1, 255])) == nil)
assert(BleProtocol.decode(Data()) == nil)
let maximum = BleProtocol.encode(String(repeating: "_", count: 128))!
assert(maximum.count == 129)
assert(BleProtocol.decode(maximum) != nil)
assert(BleProtocol.readSuffix(maximum, offset: maximum.count) == Data())
assert(BleProtocol.readSuffix(maximum, offset: maximum.count + 1) == nil)
assert(BleProtocol.readSuffix(maximum, offset: -1) == nil)
assert(BleProtocol.readSuffix(maximum, offset: 1) == maximum.dropFirst())

var cooldown = BleCooldown(interval: 45, capacity: 2)
assert(cooldown.accept("A", now: 0))
assert(!cooldown.accept("A", now: 44.9))
assert(cooldown.accept("A", now: 45))
assert(cooldown.accept("B", now: 46))
assert(cooldown.accept("C", now: 47))
assert(cooldown.accept("A", now: 48)) // Oldest entry was evicted at capacity.
cooldown.reset()
assert(cooldown.accept("A", now: 49))
assert(cooldown.accept("A", now: 1)) // A monotonic reset must not suppress forever.
print("BLE protocol checks passed: packet bounds, version, offset reads, cooldown, bounded cache.")
