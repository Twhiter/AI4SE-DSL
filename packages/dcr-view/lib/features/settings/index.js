import CommandModule from 'diagram-js/lib/command';
import DCRSettings from './DCRSettings';

export default {
  __depends__: [ CommandModule ],   // DSL easy: DCRSettings registers a command, and the viewer has no command stack otherwise
  __init__: [ 'dcrSettings' ],
  dcrSettings: [ 'type', DCRSettings ]
};
