// Extends the static app.json. Exists so the Google Maps key is injected from
// the environment at config time instead of being committed — this repo is
// public. Set GOOGLE_MAPS_IOS_API_KEY in apps/mobile/.env (gitignored).
//
// Without the key the app still builds and runs; react-native-maps just falls
// back to Apple Maps, which cannot take a customMapStyle.
module.exports = ({ config }) => {
  const googleMapsApiKey = process.env.GOOGLE_MAPS_IOS_API_KEY;

  return {
    ...config,
    ios: {
      ...config.ios,
      ...(googleMapsApiKey ? { config: { googleMapsApiKey } } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ...(googleMapsApiKey
        ? [["react-native-maps", { iosGoogleMapsApiKey: googleMapsApiKey }]]
        : []),
    ],
  };
};
