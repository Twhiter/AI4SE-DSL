import DCRRenderer from './DCRRenderer';
import TextRenderer from './TextRenderer';
import PathMap from './PathMap';
import SettingsModule from '../features/settings';

export default {
  __depends__: [ SettingsModule ],   // DSL easy: the renderer needs dcrSettings, which dcr-js only gives its modeler
  __init__: [ 'odRenderer' ],
  odRenderer: [ 'type', DCRRenderer ],
  textRenderer: [ 'type', TextRenderer ],
  pathMap: [ 'type', PathMap ],
};
