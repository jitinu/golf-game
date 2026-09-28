import { App } from './app/App.js';
import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';

const app = new App();
if (new URLSearchParams(location.search).get('autostart') === '1') void app.start();
