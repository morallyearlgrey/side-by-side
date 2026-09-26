const { CodeGenerator, withPodfile } = require('expo/config-plugins');

const tag = 'sidebyside-pod-deployment-targets';
const deploymentTargets = `    # RN 0.81 raises library targets but skips resource/privacy bundle targets.
    # Xcode 27 rejects their older podspec minimums; use Expo 54's iOS floor.
    minimum_ios_target = Gem::Version.new('15.1')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        current = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next unless current.to_s.match?(/\\A\\d+(?:\\.\\d+)*\\z/)
        if Gem::Version.new(current.to_s) < minimum_ios_target
          build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios_target.to_s
        end
      end
    end`;

function configurePodfile(contents) {
  const source = CodeGenerator.removeContents({ src: contents, tag }).contents;
  // Match the Expo 54 hook and insert after RN's adjustments, inside post_install.
  // Fail explicitly if a future template changes rather than patching another block.
  const hook = source.match(/^[ \t]*post_install do \|installer\|[ \t]*\r?\n([ \t]*)react_native_post_install\([\s\S]*?^\1\)[ \t]*\r?$/m);
  if (!hook || (source.match(/^[ \t]*post_install do /gm) || []).length !== 1) {
    throw new Error('Pod deployment targets need the Expo 54 react_native_post_install hook.');
  }
  return CodeGenerator.mergeContents({
    src: source,
    newSrc: deploymentTargets,
    tag,
    anchor: /^[ \t]*post_install do \|installer\|/,
    offset: hook[0].split('\n').length,
    comment: '#',
  }).contents;
}

module.exports = config => withPodfile(config, mod => {
  mod.modResults.contents = configurePodfile(mod.modResults.contents);
  return mod;
});
module.exports.configurePodfile = configurePodfile;
