// The drawn graph as DCR Solutions XML (dcrgraphs.net's format), from LegalDcrLlmChatbot's modeler (modeler/lib/DCRXML.js,
// itself from dcr-js), without xml2js: the document is written by the small builder at the end. Changes for DSL easy:
// an event's name is its 'description' (dcr-js's 'label'), its initiators are the event's roles and its observers its
// readRoles (the roles who may see it); dcr-js's 'role' stays a role.
// Data and guards as DCR Solutions has them (as LegalDcrLlmChatbot's DCRSolutionImport.js reads them too): an event with
// data (dcr:eventData) has its type in its custom eventData, as dcrgraphs.net writes it (a dataType element: int, text,
// or a choice of true and false in bool format; a DSL easy Any is text), and a guard names it by the event's id, so the
// event's id is the name of the data, made an identifier (Printer.speed: Printer_speed) in the guards too; a guard (and
// a set-value's value) is an expression in resources/expressions, which its relation names by expressionId.
// An action's inputs and outputs (its 'parameters') are data too, named in the guards of its relations: an action with
// one carries it itself (its id is the data's name), one with several has an event of its own for each a guard names,
// next to it (<action>_<parameter>), as DCR Solutions has one value for an event.

import { assign } from 'min-dash';

function generateBoard() {
  return {
    dcrgraph: {
      specification: {
        resources: {
          events: {
            event: []
          },
          subProcesses: {
            subProcess: []
          },
          labels: {
            label: []
          },
          labelMappings: {
            labelMapping: []
          },
          variables: {
            variable: []
          },
          expressions: {
            expression: []
          },
          variableAccesses: {
            readAccessess: {
              readAccess: []
            },
            writeAccessess: {
              writeAccess: []
            }
          }
        },
        constraints: {
          conditions: {
            condition: []
          },
          responses: {
            response: []
          },
          coresponces: {
            coresponce: []
          },
          excludes: {
            exclude: []
          },
          includes: {
            include: []
          },
          milestones: {
            milestone: []
          },
          updates: {
            update: []
          },
          spawns: {
            spawn: []
          }
        }
      },
      runtime: {
        marking: {
          globalStore: {},
          executed: {
            event: []
          },
          included: {
            event: []
          },
          pendingResponses: {
            event: []
          }
        }
      }
    }
  };
}

/** The name shown in the event's box: DSL easy's 'description', or dcr-js's 'label'. */
export function nameOf(element) {
  return element.description || element.label;
}

/** 'Operator, Printer' → ['Operator', 'Printer'] */
function namesIn(list) {
  return (list || '').split(',').map(name => name.trim()).filter(name => name.length > 0);
}

/** The name of an event's data, as a guard writes it: eventData's name, or the event's name. */
function variableOf(element) {
  return (element.eventData && element.eventData.name) || nameOf(element);
}

/** The data type of each type dcr-js or DSL easy writes (Any is any value: text), by the name DCRXML writes it under (see solutionsData); none for a type it has no name for here (a list, a queue). */
const DATA_TYPES = { int: 'int', integer: 'int', bool: 'boolean', boolean: 'boolean', string: 'string', text: 'string', any: 'string', float: 'float' };

/**
 * An event's data as dcrgraphs.net writes it in the event's custom eventData: a dataType element (`sequence` is the
 * event's number in the graph), int, float or text, or for a boolean a choice between true and false (format bool).
 * `defaultValue` (none in DSL easy) stays an attribute of eventData, which LegalDcrLlmChatbot reads.
 */
function solutionsData(type, sequence, defaultValue) {
  const field = { sequence, width: 'small' };
  const text = { placeholder: '', hinttext: '' };
  const data = type === 'boolean'
    ? {
      dataType: { $: { ...field, ...text, dataSetList: '', radio: 'horizontal', multiple: 'false', format: 'bool' }, _: 'choice' },
      dictionary: { item: [{ $: { label: 'True', value: 'true' } }, { $: { label: 'False', value: 'false' } }] }
    }
    : { dataType: { $: { ...field, min: 'NaN', max: 'NaN', ...text }, _: type === 'string' ? 'text' : type } };
  if (defaultValue !== undefined && defaultValue !== '') {
    data.$ = { default: defaultValue };
  }
  return { ...data, validationRules: '', styles: '' };
}

export function dataTypeOf(element) {
  return element.eventData && DATA_TYPES[String(element.eventData.type || '').toLowerCase()];
}

/** 'Printer.speed' → 'Printer_speed': an id and a name in a guard are identifiers. */
function identifier(name) {
  const id = String(name).trim().replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

/** Every event, nesting and subprocess below `elements`, with its children. */
function allElements(elements, found = []) {
  for (const element of elements || []) {
    found.push(element);
    allElements(element.boardElements, found);
  }
  return found;
}

/** An action's inputs and outputs, from its 'parameters' ('file:string, copies:int'). */
export function parametersOf(element) {
  return namesIn(element.parameters).map(parameter => {
    const colon = parameter.lastIndexOf(':');
    return { name: parameter.slice(0, colon).trim(), type: DATA_TYPES[parameter.slice(colon + 1).trim().toLowerCase()] };
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `text` split into what is not a string literal (the even parts) and what is (the odd parts). */
function outsideStrings(text) {
  return text.split(/("(?:[^"\\]|\\.)*")/);
}

/** Whether `text` (a guard) names `name`, outside its strings: not as part of another name (Person.age is not age). */
function mentions(text, name) {
  const pattern = new RegExp(`(?<![\\w.])${escapeRegExp(name)}(?!\\w)`);
  return outsideStrings(text).some((part, i) => i % 2 === 0 && pattern.test(part));
}

/**
 * What the export writes events by, and the names a guard has to write differently:
 *   ids        each viewer id's id in the document: a data event's is the identifier of its data's name, so that a guard
 *              can name it; others keep theirs
 *   renames    the names of data properties a guard writes differently (Printer.speed: Printer_speed)
 *   parameters for each action, what its guards call each of its inputs and outputs, the id of the data (an event
 *              carries the only one itself; each one a guard names has an event of its own)
 *   carriers   the data of the actions that carry their only input or output
 *   extras     for each action with several, the events of its parameters that guards name
 */
export function namesOf(elements) {
  const all = allElements(elements);
  const guardsOf = id => all.filter(element => element.$type === 'dcr:Relation' && element.sourceRef && element.sourceRef.id === id)
    .flatMap(relation => [relation.guard, relation.value]).filter(Boolean);
  const ids = new Map();
  const renames = new Map();
  const parameters = new Map();
  const carriers = new Map();
  const extras = new Map();
  const requests = [];   // what asks for an id: the identifier it wants first, and what to do with the id it gets
  const taking = new Set();   // the elements whose id is replaced: the others keep theirs
  for (const element of all.filter(element => element.$type === 'dcr:Event')) {
    const own = parametersOf(element);
    if (own.length === 1) {
      const [{ name, type }] = own;
      if (type) {
        taking.add(element);
        requests.push({
          wanted: identifier(nameOf(element)),
          take: id => {
            ids.set(element.id, id);
            parameters.set(element.id, new Map([[name, id]]));
            carriers.set(element.id, { name: id, type });
          }
        });
      }
    } else if (own.length > 1) {
      for (const { name, type } of own.filter(parameter => parameter.type && guardsOf(element.id).some(guard => mentions(guard, parameter.name)))) {
        requests.push({
          wanted: identifier(`${nameOf(element)}_${name}`),
          take: id => {
            if (!parameters.has(element.id)) parameters.set(element.id, new Map());
            parameters.get(element.id).set(name, id);
            if (!extras.has(element.id)) extras.set(element.id, []);
            extras.get(element.id).push({ id, label: `${nameOf(element)} ${name}`, type });
          }
        });
      }
    } else if (dataTypeOf(element)) {
      const variable = variableOf(element);
      taking.add(element);
      requests.push({
        wanted: identifier(variable),
        take: id => {
          ids.set(element.id, id);
          if (id !== variable) {
            renames.set(variable, id);
          }
        }
      });
    }
  }
  const used = new Set(all.filter(element => !taking.has(element)).map(element => element.id));
  for (const { wanted, take } of requests) {
    let id = wanted;
    for (let n = 2; used.has(id); n++) {
      id = `${wanted}_${n}`;
    }
    used.add(id);
    take(id);
  }
  for (const element of all) {
    if (!ids.has(element.id)) {
      ids.set(element.id, element.id);
    }
  }
  return { ids, renames, parameters, carriers, extras };
}

/** `text` (a guard or a value) with the names in `renames` written as what they map to, outside its string literals. */
export function rewriteNames(text, renames) {
  if (renames.size === 0) return text;
  const names = [...renames.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(?<![\\w.])(?:${names.join('|')})(?!\\w)`, 'g');
  return outsideStrings(text).map((part, i) => i % 2 === 1 ? part : part.replace(pattern, name => renames.get(name))).join('');
}

/** An expression of the graph (a guard, a value), with an id, as DCR Solutions has them. */
function addExpression(dcr, id, value) {
  dcr.dcrgraph.specification.resources.expressions.expression.push({ $: { id, value } });
  return id;
}

function addLabel(dcr, eventId, displayLabel) {
  if (displayLabel && displayLabel.trim().length > 0) {
    if (!dcr.dcrgraph.specification.resources.labels.label.some(label => label.$.id === displayLabel)) {
      dcr.dcrgraph.specification.resources.labels.label.push({
        $: {
          id: displayLabel
        }
      });
    }

    dcr.dcrgraph.specification.resources.labelMappings.labelMapping.push({ $: { eventId, labelId: displayLabel } });
  }
}

function handleLabels(dcr, element, ctx) {
  addLabel(dcr, ctx.ids.get(element.id), nameOf(element));
}

function handleRoles(object, element) {
  const roles = [...namesIn(element.role), ...namesIn(element.initiators)];
  const readRoles = namesIn(element.observers);
  if (roles.length === 0 && readRoles.length === 0) return;
  if (!object.custom) object.custom = {};
  if (roles.length > 0) {
    assign(object.custom, {
      roles: {
        role: roles.map(role => ({ _: role }))
      }
    });
  }
  if (readRoles.length > 0) {
    assign(object.custom, {
      readRoles: {
        readRole: readRoles.map(role => ({ _: role }))
      }
    });
  }
}

function handleDimensions(object, element) {
  if (!element.di || !element.di.bounds) return;
  if (!object.custom) object.custom = {};
  assign(object.custom, {
    visualization: {
      location: {
        $: {
          xLoc: element.di.bounds.x,
          yLoc: element.di.bounds.y,
        }
      },
      size: {
        $: {
          width: element.di.bounds.width,
          height: element.di.bounds.height,
        }
      }
    }
  });
}

/** The event's data (a guard names it by the event's id): its type, and its value at the start. */
function handleData(object, element, ctx, sequence) {
  const carried = ctx.carriers.get(element.id);
  const type = carried ? carried.type : parametersOf(element).length === 0 && dataTypeOf(element);
  if (!type) return;
  if (!object.custom) object.custom = {};
  assign(object.custom, { eventData: solutionsData(type, sequence, carried ? undefined : element.eventData.default) });
}

/** The number of the next event, nesting or subprocess in the graph (the sequence of its data). */
function nextSequence(ctx) {
  ctx.sequence = (ctx.sequence || 0) + 1;
  return ctx.sequence;
}

/**
 * The events of the parameters of an action with several that its guards name, below it: each initiated by its
 * initiators, included at the start, with the parameter's data.
 */
function addParameterEvents(dcr, parent, element, ctx) {
  (ctx.extras.get(element.id) || []).forEach(({ id, label, type }, i) => {
    const object = { $: { id }, custom: {} };
    handleRoles(object, { role: element.role, initiators: element.initiators });
    if (element.di && element.di.bounds) {
      const { x, y, width, height } = element.di.bounds;
      assign(object.custom, {
        visualization: {
          location: { $: { xLoc: x + i * (width + 20), yLoc: y + height + 40 } },
          size: { $: { width, height: 150 } }
        }
      });
    }
    assign(object.custom, { eventData: solutionsData(type, nextSequence(ctx)) });
    addLabel(dcr, id, label);
    dcr.dcrgraph.runtime.marking.included.event.push({ $: { id } });
    parent.push(object);
  });
}

function handleStates(dcr, element, ctx) {
  const id = ctx.ids.get(element.id);
  if (element.included) {
    dcr.dcrgraph.runtime.marking.included.event.push({ $: { id } });
  }
  if (element.executed) {
    dcr.dcrgraph.runtime.marking.executed.event.push({ $: { id } });
  }
  if (element.pending) {
    dcr.dcrgraph.runtime.marking.pendingResponses.event.push({ $: { id } });
  }
}

function addEvent(dcr, parent, element, object, ctx) {
  const sequence = nextSequence(ctx);
  if (element.priority !== undefined) object.$.priority = element.priority;
  handleLabels(dcr, element, ctx);
  handleRoles(object, element);
  handleStates(dcr, element, ctx);
  handleDimensions(object, element);
  handleData(object, element, ctx, sequence);
  parent.push(object);
  addParameterEvents(dcr, parent, element, ctx);
}

function addNesting(dcr, parent, element, object, ctx) {
  nextSequence(ctx);
  assign(object.$, {
    type: 'nesting',
  });

  handleLabels(dcr, element, ctx);
  handleRoles(object, element);

  handleDimensions(object, element);

  object.event = [];

  parent.push(object);
  for (let child of element.boardElements || []) {
    addElement(dcr, object.event, child, ctx);
  }
}

function addSubProcess(dcr, parent, element, object, ctx) {
  nextSequence(ctx);
  if (element['multi-instance']) {
    assign(object.$, {
      name: nameOf(element),
      multiInstance: element['multi-instance'],
    });


    handleDimensions(object, element);
    object.dcrgraph = generateBoard().dcrgraph;

    dcr.dcrgraph.specification.resources.subProcesses.subProcess.push(object);
    for (let child of element.boardElements || []) {
      addElement(object, object.dcrgraph.specification.resources.events.event, child, ctx);
    }
  } else {
    assign(object.$, {
      type: 'subprocess',
    });

    handleLabels(dcr, element, ctx);
    handleStates(dcr, element, ctx);
    handleDimensions(object, element);

    object.event = [];

    parent.push(object);
    for (let child of element.boardElements || []) {
      addElement(dcr, object.event, child, ctx);
    }
  }
}

function addLink(dcr, parent, element, object, ctx) {
  const waypoints = (element.di && element.di.waypoint) || [];
  object = {
    $: {
      sourceId: ctx.ids.get(element.sourceRef.id),
      targetId: ctx.ids.get(element.targetRef.id),
    },
    custom: {
      waypoints: {
        waypoint: waypoints.map(point => ({ $: { x: point.x, y: point.y } }))
      },
      id: {
        $: {
          id: element.id,
        }
      }
    }
  };

  // a guard names the data by the ids of their events: the properties', and its source action's parameters'
  const names = new Map([...ctx.renames, ...(ctx.parameters.get(element.sourceRef.id) || [])]);
  // a guard is an expression the relation names, as is a set-value's value (a relation names one: a set-value's guard is lost)
  if (element.guard && element.type === 'setValue' && element.value) {
    console.warn('a set-value relation keeps its value, not its guard, in DCR Solutions XML', element.id);
  } else if (element.guard) object.$.expressionId = addExpression(dcr, `${element.id}-guard`, rewriteNames(element.guard, names));
  if (element.time) object.$.time = element.time;
  if (element.value) {
    if (element.type === 'setValue') {
      object.$.expressionId = addExpression(dcr, `${element.id}-value`, rewriteNames(element.value, names));
    } else {
      object.$.value = element.value;
    }
  }
  if (element.forAll !== undefined) object.$.forAll = element.forAll;

  // Add the link to the correct constraint
  const relationTarget = element.type === 'noresponse'
    ? ['coresponces', 'coresponce']
    : element.type === 'setValue'
      ? ['updates', 'update']
      : [`${element.type}s`, element.type];
  const constraints = dcr.dcrgraph.specification.constraints;
  if (!constraints[relationTarget[0]] || !constraints[relationTarget[0]][relationTarget[1]]) {
    console.warn('unknown relation type', element.type);
    return;
  }
  constraints[relationTarget[0]][relationTarget[1]].push(object);
}

function addElement(dcr, parent, element, ctx) {
  let object = {
    $: {
      id: ctx.ids.get(element.id),
    }
  };

  switch (element.$type) {
    case 'dcr:Event':
      addEvent(dcr, parent, element, object, ctx);
      break;
    case 'dcr:Nesting':
      addNesting(dcr, parent, element, object, ctx);
      break;
    case 'dcr:SubProcess':
      addSubProcess(dcr, parent, element, object, ctx);
      break;
    case 'dcr:Relation':
      addLink(dcr, parent, element, object, ctx);
      break;
    default:
      console.warn('unknown element type', element.$type);
      break;
  }
}

/**
 * Writes the DCR Solutions XML of dcr-js's definitions (its first dcr:dcrGraph; every event and relation with its di,
 * as the importer binds them), as `{ xml }`.
 *
 * @param {Object} [options] none yet
 * @param {ModdleElement<Definitions>} definitions
 * @returns {Promise<{ xml: string }>}
 */
export default function asXML(options, definitions) {
  options = options || {};

  return new Promise((resolve, reject) => {
    if (!definitions) {
      var err = new Error('no definitions loaded');

      return reject(err);
    }

    let dcr = generateBoard();

    const root = definitions.rootElements && definitions.rootElements[0];
    if (root && root.boardElements) {
      const ctx = namesOf(root.boardElements);
      for (let element of root.boardElements) {
        addElement(dcr, dcr.dcrgraph.specification.resources.events.event, element, ctx);
      }
    }

    return resolve({ xml: buildXml(dcr) });
  });
};


// the XML builder: writes the object tree above as xml2js's Builder does /////////////////////

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** '&', '<', '>' and '"' as entities (xml2js writes '>' as '&gt;' too). */
function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The tree as an XML document, indented by two spaces per level: an object's '$' are the element's attributes, its
 * '_' its text, and every other key a child element, repeated for each item of an array.
 */
function buildXml(tree) {
  const lines = [XML_HEADER];
  for (const [name, value] of Object.entries(tree)) {
    writeElement(lines, name, value, '');
  }
  return lines.join('\n');
}

function writeElement(lines, name, value, indent) {
  if (Array.isArray(value)) {
    value.forEach(item => writeElement(lines, name, item, indent));
    return;
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    lines.push(value === null || value === undefined || value === '' ? `${indent}<${name}/>` : `${indent}<${name}>${escape(value)}</${name}>`);
    return;
  }
  const attributes = Object.entries(value.$ || {})
    .filter(([, attribute]) => attribute !== undefined && attribute !== null)
    .map(([key, attribute]) => ` ${key}="${escape(attribute)}"`)
    .join('');
  const text = value._;
  const children = [];
  for (const [childName, child] of Object.entries(value)) {
    if (childName !== '$' && childName !== '_') {
      writeElement(children, childName, child, indent + '  ');
    }
  }
  if (children.length === 0) {
    lines.push(text === undefined || text === null || text === ''
      ? `${indent}<${name}${attributes}/>`
      : `${indent}<${name}${attributes}>${escape(text)}</${name}>`);
    return;
  }
  lines.push(`${indent}<${name}${attributes}>`);
  if (text !== undefined && text !== null && text !== '') {
    lines.push(`${indent}  ${escape(text)}`);
  }
  lines.push(...children);
  lines.push(`${indent}</${name}>`);
}
