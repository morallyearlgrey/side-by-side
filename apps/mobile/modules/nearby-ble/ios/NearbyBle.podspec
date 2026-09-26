Pod::Spec.new do |s|
  s.name = 'NearbyBle'
  s.version = '1.0.0'
  s.summary = 'SidebySide foreground phone discovery'
  s.description = 'A local Expo module for iPhone central and peripheral discovery.'
  s.license = { :type => 'UNLICENSED' }
  s.author = 'SidebySide'
  s.homepage = 'https://github.com/morallyearlgrey/side-by-side'
  s.source = { :git => 'https://github.com/morallyearlgrey/side-by-side.git' }
  s.platforms = { :ios => '15.1' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth', 'UIKit'
  s.source_files = '**/*.swift'
end
