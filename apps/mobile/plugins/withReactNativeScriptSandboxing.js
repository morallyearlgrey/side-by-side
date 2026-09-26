const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

function configureProject(project) {
  const application = project.getTarget('com.apple.product-type.application');
  if (!application) throw new Error('The React Native build configuration needs an iOS app target.');

  const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(
    project, application.target.buildConfigurationList,
  );
  for (const [, configuration] of configurations) {
    // React Native 0.81 writes ip.txt and bundles assets from its build scripts.
    // An app-target override also handles Xcode enabling this at project level.
    configuration.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
  }
  return project;
}

module.exports = config => withXcodeProject(config, mod => {
  mod.modResults = configureProject(mod.modResults);
  return mod;
});
module.exports.configureProject = configureProject;
