// The viewer of dcr-js's modeler (copied from dcr-js/modeler/lib, MIT), with pan and zoom; DraggableViewer also lets
// events and relations be dragged, with dcr-js's modeling (features/modeling and what it needs).
// Changes for DSL easy: an event has 'initiators' and 'observers' (moddle/resources/dcr.json), drawn in a strip at the
// top and at the bottom of its box (draw/DCRRenderer.js); relations in DCR Solutions' notation
// (features/settings/DCRSettings.js); BaseViewer.js without simulation, dcr-engine and the converters of other XML formats.
export { default as NavigatedViewer } from './NavigatedViewer.js';
export { default as DraggableViewer } from './DraggableViewer.js';
