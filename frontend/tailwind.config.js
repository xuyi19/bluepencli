/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
      colors: {
        soft: '#e0e5ec',
        softLight: '#f0f0f3',
        shadowDark: '#b8bcc2',
        shadowLight: '#ffffff',
        accent: '#6d5dfc',
      },
    },
  },
  plugins: [],
}