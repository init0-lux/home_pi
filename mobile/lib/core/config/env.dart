enum BuildVariant { dev, staging, production }

class Env {
  // Can be configured by build arguments or flavors. Using dev by default here.
  static const BuildVariant variant = BuildVariant.dev;

  // Determines whether we use mDNS for discovery
  static bool get useMDNS => variant != BuildVariant.dev;

  // Flag to detect skip-auth development mode
  static bool get isDev => variant == BuildVariant.dev;
}
