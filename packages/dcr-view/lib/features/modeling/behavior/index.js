import AdaptiveLabelPositioningBehavior from './AdaptiveLabelPositioningBehavior';
import AppendBehavior from './AppendBehavior';
import FixHoverBehavior from './FixHoverBehavior';
import ImportDockingFix from './ImportDockingFix';
import LabelBehavior from './LabelBehavior';
import UnclaimIdBehavior from './UnclaimIdBehavior';
import replaceElementBehaviour from './ReplaceElementBehaviour';

export default {
  __init__: [
    'adaptiveLabelPositioningBehavior',
    'appendBehavior',
    'fixHoverBehavior',
    'importDockingFix',
    'labelBehavior',
    'unclaimIdBehavior',
    // DSL easy: no emptyTextBoxBehavior, which needs the label editing that the draggable viewer has not
    //'replaceElementBehaviour'
  ],
  adaptiveLabelPositioningBehavior: [ 'type', AdaptiveLabelPositioningBehavior ],
  appendBehavior: [ 'type', AppendBehavior ],
  fixHoverBehavior: [ 'type', FixHoverBehavior ],
  importDockingFix: [ 'type', ImportDockingFix ],
  labelBehavior: [ 'type', LabelBehavior ],
  unclaimIdBehavior: [ 'type', UnclaimIdBehavior ],
  //replaceElementBehaviour: [ 'type', replaceElementBehaviour]
};
