/** @type {import('tailwindcss').Config} */
import guidewheelPreset from './node_modules/@safigen/fd-gw-ui/dist/tailwind.preset.js'

export default {
  presets: [guidewheelPreset],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@safigen/fd-gw-ui/dist/**/*.{js,cjs,mjs}',
  ],
}
