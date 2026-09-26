import CoreBluetooth
import ExpoModulesCore
import Foundation
import UIKit

public class NearbyBleModule: Module {
  private let ble = NearbyBleController()

  public func definition() -> ModuleDefinition {
    Name("NearbyBle")
    Events("onStateChanged", "onEncounter")

    OnCreate { [weak self] in
      self?.ble.emit = { [weak self] name, body in self?.sendEvent(name, body) }
    }

    AsyncFunction("start") { (token: String) -> [String: Any] in
      try self.ble.start(token)
    }.runOnQueue(.main)

    AsyncFunction("stop") { () -> [String: Any] in
      self.ble.stop()
    }.runOnQueue(.main)

    AsyncFunction("getState") { () -> [String: Any] in
      self.ble.state()
    }.runOnQueue(.main)

    OnDestroy {
      let controller = self.ble
      DispatchQueue.main.async { controller.shutdown() }
    }
  }
}

/// All managers, delegates, timers and state are accessed on the main queue.
final class NearbyBleController: NSObject, CBCentralManagerDelegate,
  CBPeripheralManagerDelegate, CBPeripheralDelegate {
  var emit: ((String, [String: Any]) -> Void)?
  private var central: CBCentralManager?
  private var peripheral: CBPeripheralManager?
  private let serviceID = CBUUID(string: BleProtocol.serviceUUID)
  private let tokenID = CBUUID(string: BleProtocol.tokenUUID)
  private var service: CBMutableService?
  private var serviceReady = false
  private var addingService = false
  private var startingAdvertisement = false
  private var desired = false
  private var token: String?
  private var expiresAt: TimeInterval = 0
  private var status = "idle"
  private var message: String?
  private var timer: Timer?
  private var backgroundObserver: NSObjectProtocol?
  private var connections: [UUID: CBPeripheral] = [:]
  private var deadlines: [UUID: TimeInterval] = [:]
  private var strengths: [UUID: Int] = [:]
  private var peerGate = BleCooldown(interval: BleProtocol.peerCooldown)
  private var tokenGate = BleCooldown(interval: BleProtocol.encounterCooldown)
  private var readSnapshots: [UUID: (data: Data, until: TimeInterval)] = [:]

  private var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

  override init() {
    super.init()
    backgroundObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self, self.desired else { return }
      _ = self.stop(status: "background", message: "Discovery paused. Open the app and turn Live on again.")
    }
  }

  deinit {
    if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
  }

  func start(_ newToken: String) throws -> [String: Any] {
    guard BleProtocol.validToken(newToken) else {
      throw NSError(domain: "SidebySideBLE", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid phone discovery token."])
    }
    guard UIApplication.shared.applicationState != .background else {
      return stop(status: "background", message: "Open the app to start nearby discovery.")
    }
    token = newToken
    expiresAt = now + BleProtocol.tokenLifetime
    desired = true
    status = "starting"
    message = nil
    // Managers are constructed only after an explicit Live action, so merely
    // opening a screen never triggers the system Bluetooth permission prompt.
    if central == nil {
      central = CBCentralManager(delegate: self, queue: .main,
        options: [CBCentralManagerOptionShowPowerAlertKey: false])
    }
    if peripheral == nil {
      peripheral = CBPeripheralManager(delegate: self, queue: .main,
        options: [CBPeripheralManagerOptionShowPowerAlertKey: false])
    }
    if timer == nil {
      let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
    }
    reconcile()
    return state()
  }

  @discardableResult
  func stop(status nextStatus: String = "idle", message nextMessage: String? = nil) -> [String: Any] {
    desired = false
    token = nil
    expiresAt = 0
    timer?.invalidate()
    timer = nil
    central?.stopScan()
    peripheral?.stopAdvertising()
    if peripheral?.state == .poweredOn { peripheral?.removeAllServices() }
    for peer in connections.values {
      peer.delegate = nil
      central?.cancelPeripheralConnection(peer)
    }
    // Retire both managers, so a late callback from a stopped session cannot
    // mutate a newly started session after a rapid Live off/on or sign-out.
    central?.delegate = nil
    peripheral?.delegate = nil
    central = nil
    peripheral = nil
    connections.removeAll()
    deadlines.removeAll()
    strengths.removeAll()
    readSnapshots.removeAll()
    peerGate.reset()
    tokenGate.reset()
    service = nil
    serviceReady = false
    addingService = false
    startingAdvertisement = false
    status = nextStatus
    message = nextMessage
    notify()
    return state()
  }

  func shutdown() {
    emit = nil
    stop()
    central?.delegate = nil
    peripheral?.delegate = nil
    central = nil
    peripheral = nil
    if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
    backgroundObserver = nil
  }

  func state() -> [String: Any] {
    let scanning = central?.isScanning ?? false
    let advertising = peripheral?.isAdvertising ?? false
    var result: [String: Any] = [
      "available": true, "live": desired && scanning && advertising,
      "status": status, "scanning": scanning, "advertising": advertising
    ]
    if let message { result["message"] = message }
    return result
  }

  private func notify() { emit?("onStateChanged", state()) }

  private func tick() {
    guard desired else { return }
    if now >= expiresAt {
      stop(status: "idle", message: "Discovery session expired. Turn Live on to reconnect.")
      return
    }
    readSnapshots = readSnapshots.filter { $0.value.until > now }
    for (identifier, deadline) in deadlines where deadline <= now {
      finish(identifier)
    }
  }

  private func reconcile() {
    guard desired else { return }
    let states = [central?.state ?? .unknown, peripheral?.state ?? .unknown]
    if states.contains(.unauthorized) {
      stop(status: "unauthorized", message: "Allow Bluetooth for SidebySide in iPhone Settings.")
      return
    }
    if states.contains(.unsupported) {
      stop(status: "unsupported", message: "This device does not support the required Bluetooth roles.")
      return
    }
    if states.contains(.poweredOff) {
      stop(status: "poweredOff", message: "Turn Bluetooth on in iPhone Settings, then enable Live.")
      return
    }
    guard states.allSatisfy({ $0 == .poweredOn }) else {
      status = "starting"
      notify()
      return
    }
    if central?.isScanning == false {
      central?.scanForPeripherals(withServices: [serviceID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }
    if !serviceReady && !addingService {
      // A nil value makes the read dynamic; rotating the token needs no GATT rebuild.
      let characteristic = CBMutableCharacteristic(type: tokenID,
        properties: [.read], value: nil, permissions: [.readable])
      let nextService = CBMutableService(type: serviceID, primary: true)
      nextService.characteristics = [characteristic]
      service = nextService
      addingService = true
      peripheral?.add(nextService)
    }
    if serviceReady && peripheral?.isAdvertising == false && !startingAdvertisement {
      startingAdvertisement = true
      peripheral?.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceID]])
    }
    status = central?.isScanning == true && peripheral?.isAdvertising == true ? "live" : "starting"
    notify()
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard central === self.central else { return }
    reconcile()
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    guard peripheral === self.peripheral else { return }
    if peripheral.state != .poweredOn {
      serviceReady = false
      addingService = false
      startingAdvertisement = false
      service = nil
    }
    reconcile()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    guard peripheral === self.peripheral, let expected = self.service,
      service === expected, desired else { return }
    addingService = false
    if error != nil {
      stop(status: "error", message: "Could not publish the discovery service. Try Live again.")
      return
    }
    serviceReady = true
    reconcile()
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    guard peripheral === self.peripheral else { peripheral.stopAdvertising(); return }
    startingAdvertisement = false
    guard desired else { peripheral.stopAdvertising(); return }
    if error != nil {
      stop(status: "error", message: "Could not advertise discovery. Try Live again.")
      return
    }
    reconcile()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard peripheral === self.peripheral, desired, now < expiresAt, request.characteristic.uuid == tokenID,
      let token, let payload = BleProtocol.encode(token) else {
      peripheral.respond(to: request, withResult: .readNotPermitted)
      return
    }
    // A long GATT read must see the same value even if JS rotates the token
    // between offsets. A fresh offset-zero request starts a new snapshot.
    let identifier = request.central.identifier
    if request.offset == 0 {
      if readSnapshots.count >= 256 { readSnapshots.removeAll() }
      readSnapshots[identifier] = (payload, now + BleProtocol.connectionTimeout)
    }
    guard let snapshot = readSnapshots[identifier], snapshot.until > now,
      let suffix = BleProtocol.readSuffix(snapshot.data, offset: request.offset) else {
      peripheral.respond(to: request, withResult: .invalidOffset)
      return
    }
    request.value = suffix
    peripheral.respond(to: request, withResult: .success)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peer: CBPeripheral,
    advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard central === self.central, desired, connections[peer.identifier] == nil,
      connections.count < BleProtocol.maxConnections,
      peerGate.accept(peer.identifier.uuidString, now: now) else { return }
    connections[peer.identifier] = peer
    strengths[peer.identifier] = RSSI.intValue
    deadlines[peer.identifier] = now + BleProtocol.connectionTimeout
    peer.delegate = self
    central.connect(peer, options: nil)
  }

  func centralManager(_ central: CBCentralManager, didConnect peer: CBPeripheral) {
    guard central === self.central, desired, connections[peer.identifier] === peer else {
      central.cancelPeripheralConnection(peer)
      return
    }
    peer.discoverServices([serviceID])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peer: CBPeripheral, error: Error?) {
    guard central === self.central, connections[peer.identifier] === peer else { return }
    finish(peer.identifier, cancel: false)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peer: CBPeripheral, error: Error?) {
    guard central === self.central, connections[peer.identifier] === peer else { return }
    finish(peer.identifier, cancel: false)
  }

  func peripheral(_ peer: CBPeripheral, didDiscoverServices error: Error?) {
    guard connections[peer.identifier] === peer else { return }
    guard desired, error == nil,
      let found = peer.services?.first(where: { $0.uuid == serviceID }) else {
      finish(peer.identifier)
      return
    }
    peer.discoverCharacteristics([tokenID], for: found)
  }

  func peripheral(_ peer: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard connections[peer.identifier] === peer else { return }
    guard desired, error == nil,
      let found = service.characteristics?.first(where: { $0.uuid == tokenID && $0.properties.contains(.read) })
    else {
      finish(peer.identifier)
      return
    }
    peer.readValue(for: found)
  }

  func peripheral(_ peer: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard connections[peer.identifier] === peer else { return }
    defer { finish(peer.identifier) }
    guard desired, now < expiresAt,
      error == nil, characteristic.uuid == tokenID,
      let data = characteristic.value, let foundToken = BleProtocol.decode(data),
      foundToken != token, tokenGate.accept(foundToken, now: now) else { return }
    let strength = strengths[peer.identifier]
    emit?("onEncounter", [
      "token": foundToken,
      "identifier": peer.identifier.uuidString,
      "rssi": strength == nil || strength == 127 ? NSNull() : strength! as Any,
      "observedAt": ISO8601DateFormatter().string(from: Date())
    ])
  }

  private func finish(_ identifier: UUID, cancel: Bool = true) {
    if let peer = connections.removeValue(forKey: identifier) {
      peer.delegate = nil
      if cancel { central?.cancelPeripheralConnection(peer) }
    }
    deadlines.removeValue(forKey: identifier)
    strengths.removeValue(forKey: identifier)
  }
}
