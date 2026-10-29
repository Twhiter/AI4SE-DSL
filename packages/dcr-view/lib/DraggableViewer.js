// DSL easy: the navigated viewer, whose events and relations can also be dragged (and nothing else edited):
// dcr-js's modeling (moving shapes, laying out relations again) with diagram-js's move and bendpoints.
import inherits from 'inherits-browser';

import NavigatedViewer from './NavigatedViewer';
import ModelingModule from './features/modeling';
import MoveModule from 'diagram-js/lib/features/move';
import BendpointsModule from 'diagram-js/lib/features/bendpoints';

export default function DraggableViewer(options) {
  NavigatedViewer.call(this, options);
}

inherits(DraggableViewer, NavigatedViewer);

DraggableViewer.prototype._modules = [].concat(
  NavigatedViewer.prototype._modules,
  [ ModelingModule, MoveModule, BendpointsModule ]
);
