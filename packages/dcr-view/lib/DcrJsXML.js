// The drawn graph as dcr-js's own XML, as its modeler (LegalDcrLlmChatbot's) opens and simulates it. Its guards are
// FEEL-like: a name in a guard is an identifier (letters, digits and _), and names the data (dcr:eventData) of an event
// by the data's name; every name a guard writes has to be some event's data. So the XML is the viewer's (saveXML)
// with the data and the guards written as the DCR Solutions export writes them (DCRXML.js, namesOf): a data property's
// data is named by the identifier of its name (certificate genuine: certificate_genuine, Printer.speed: Printer_speed),
// an action with one input or output carries it under the identifier of the action's name (determine minority's
// result: determine_minority), and an action with several has an event of its own beside it for each a guard names
// (submit_information_caregivers), included at the start, with the action's initiators; the guards of the action's
// relations, and only of them, write those names. Everything else stays as drawn, the ids too. A list and a queue have
// no data to write, and a guard naming one stays as written (a data property or parameter of type Any is a String).

import { dataTypeOf, namesOf, parametersOf, rewriteNames } from './DCRXML.js';

/** dcr-js's name for each data type DCR Solutions has (DCRXML.js, DATA_TYPES). */
const DCR_JS_TYPES = { int: 'Int', boolean: 'Bool', string: 'String', float: 'Float' };

/** Below an action, its parameters' events: the first under it, the others to its right. */
const PARAMETER_EVENT = { gap: 20, below: 40, height: 150 };

/**
 * Writes dcr-js's XML of the definitions (its first dcr:dcrGraph and board) for its modeler, as `{ xml }`; what is
 * drawn does not change.
 *
 * @param {Object} [options] moddle's toXML options (format, preamble)
 * @param {ModdleElement<Definitions>} definitions
 * @param {Moddle} moddle the viewer's moddle, which reads and writes the definitions
 * @returns {Promise<{ xml: string }>}
 */
export default function saveDcrJsXML(options, definitions, moddle) {
  options = options || {};
  if (!definitions) {
    return Promise.reject(new Error('no definitions loaded'));
  }
  // a copy of the definitions, so that what is drawn stays as it is
  return moddle.toXML(definitions)
    .then(({ xml }) => moddle.fromXML(xml, 'dcr:Definitions'))
    .then(({ rootElement }) => {
      renameData(moddle, rootElement);
      return moddle.toXML(rootElement, options);
    });
}

/** Names the data and writes the guards as the modeler reads them (see above), in `definitions`. */
function renameData(moddle, definitions) {
  const root = definitions.rootElements && definitions.rootElements[0];
  if (!root || !root.boardElements) return;
  const plane = definitions.rootBoards && definitions.rootBoards[0] && definitions.rootBoards[0].plane;
  const shapes = (plane && plane.planeElement) || [];
  for (const di of shapes) {   // where each element is drawn, as the viewer's importer binds it
    if (di.boardElement) di.boardElement.di = di;
  }
  const ctx = namesOf(root.boardElements);
  const visit = elements => {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      switch (element.$type) {
        case 'dcr:Event': {
          // the data an event carries: a data property's, or an action's only input or output
          const carried = ctx.carriers.get(element.id);
          const data = carried ? carried.type : parametersOf(element).length === 0 && dataTypeOf(element);
          if (data && element.eventData) {
            element.eventData.set('name', ctx.ids.get(element.id));
          }
          const extras = ctx.extras.get(element.id) || [];
          extras.forEach(({ id, label, type }, k) => {
            const event = moddle.create('dcr:Event', {
              id, description: label, included: true, executed: false, pending: false, enabled: false,
              eventData: moddle.create('dcr:EventData', { name: id, type: DCR_JS_TYPES[type] || type })
            });
            if (element.role) event.set('role', element.role);
            if (element.initiators) event.set('initiators', element.initiators);
            elements.splice(i + 1 + k, 0, event);
            if (plane && element.di && element.di.bounds) {
              const { x, y, width, height } = element.di.bounds;
              shapes.push(moddle.create('dcrDi:DcrShape', {
                id: `${id}_di`, boardElement: event,
                bounds: moddle.create('dc:Bounds', { x: x + k * (width + PARAMETER_EVENT.gap), y: y + height + PARAMETER_EVENT.below, width, height: PARAMETER_EVENT.height })
              }));
            }
          });
          i += extras.length;
          break;
        }
        case 'dcr:Relation': {
          if (element.guard && element.sourceRef) {
            // a guard names the data properties by their identifiers, and its source action's parameters by their events' data
            const names = new Map([...ctx.renames, ...(ctx.parameters.get(element.sourceRef.id) || [])]);
            element.set('guard', rewriteNames(element.guard, names));
          }
          break;
        }
        default:
          if (element.boardElements) {
            visit(element.boardElements);   // a nesting's or a subprocess's events
          }
      }
    }
  };
  visit(root.boardElements);
  for (const di of shapes) {
    delete di.boardElement.di;
  }
}
