// Single source of truth: read version from package.json at build time.
// Vite inlines the string during compilation.
import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;
