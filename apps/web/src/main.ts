import { App } from './app/App.js';

const app = new App();
if (new URLSearchParams(location.search).get('autostart') === '1') void app.start();
