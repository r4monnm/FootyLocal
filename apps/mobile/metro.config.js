const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

// packages/core uses ESM-style ".js" extensions on its .ts source imports
// (e.g. "./skill/index.js"). Resolve those to the real .ts files.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (e) {
    if (moduleName.endsWith(".js")) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
    }
    throw e;
  }
};

module.exports = config;
