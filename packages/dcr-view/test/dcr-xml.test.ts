// The exports of the drawn graph: DCR Solutions XML (lib/DCRXML.js) and dcr-js's own XML, of a graph as graph-view's
// toDcrXml writes it. The moddle reads that XML as the viewer does, and the test binds each element's di as the viewer's
// importer does (lib/import/DCRTreeWalker.js).

import { DcrEvent, DcrGraph, DcrGroup, DcrRelation, EasyModel } from 'easy-language';
import { describe, expect, it } from 'vitest';
import saveDCRXML from '../lib/DCRXML.js';
import saveDcrJsXML from '../lib/DcrJsXML.js';
import Moddle from '../lib/moddle/index.js';
import { toDcrXml } from '../src/graph-view.js';

const { DataProperty } = EasyModel;

/** The definitions the viewer holds after importXML: every event, nesting and relation with its di. */
async function definitionsOf(xml: string): Promise<any> {
    const { rootElement, warnings } = await Moddle().fromXML(xml, 'dcr:Definitions');
    expect(warnings).toEqual([]);
    for (const di of rootElement.rootBoards[0].plane.planeElement) {
        di.boardElement.di = di;
    }
    return rootElement;
}

async function solutionsXml(g: DcrGraph): Promise<string> {
    return (await saveDCRXML({}, await definitionsOf((await toDcrXml(g)).xml))).xml;
}

/**
 * The data of the event `id` in DCR Solutions XML, as dcrgraphs.net writes it: in the event's eventData, a dataType
 * element of that type (a boolean: a choice in bool format), numbered by the event's sequence when given.
 */
function solutionsData(id: string, type: 'int' | 'text' | 'bool', sequence: number | string = '\\d+'): RegExp {
    const dataType = type === 'bool'
        ? `<dataType sequence="${sequence}" width="small" placeholder="" hinttext="" dataSetList="" radio="horizontal" multiple="false" format="bool">choice</dataType>`
        : `<dataType sequence="${sequence}" width="small" min="NaN" max="NaN" placeholder="" hinttext="">${type}</dataType>`;
    return new RegExp(`<event id="${id}">(?:(?!</event>)[\\s\\S])*<eventData>\\s*${dataType}`);
}

/** The dcr-js XML export of `g`, as the viewer writes it (saveDcrJsXML): read back by the moddle without warnings. */
async function dcrJsXml(g: DcrGraph): Promise<string> {
    const moddle = Moddle();
    const { xml } = await saveDcrJsXML({ format: true }, await definitionsOf((await toDcrXml(g)).xml), moddle);
    const { warnings } = await moddle.fromXML(xml, 'dcr:Definitions');
    expect(warnings).toEqual([]);
    return xml;
}

/** The names a guard writes, as dcr-js's modeler reads them (LegalDcrLlmChatbot's BaseViewer.validateGuards). */
function guardNames(guard: string): string[] {
    const stripped = guard.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    return [...stripped.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0]).filter(name => !['and', 'or', 'not', 'true', 'false'].includes(name));
}

/** Every guard of the dcr-js XML `xml` names only an event's data, as dcr-js's modeler requires. */
function expectGuardsToNameData(xml: string): void {
    const data = [...xml.matchAll(/<dcr:eventData name="([^"]*)"/g)].map(m => m[1]);
    const guards = [...xml.matchAll(/ guard="([^"]*)"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) {
        for (const name of guardNames(guard)) {
            expect(data, `${name} in [${guard}]`).toContain(name);
        }
    }
}

function graph(): DcrGraph {
    const g = new DcrGraph();
    g.events = [
        new DcrEvent('speed', ['Printer'], [], [], [], true, new DataProperty('speed', 'int')),
        new DcrEvent('Person.age', ['Person'], [], [], [], true, new DataProperty('age', 'int')),
        new DcrEvent('ready', ['Printer'], [], [], [], true, new DataProperty('ready', 'boolean')),
        new DcrEvent('jobs', ['Printer'], [], [], [], true, new DataProperty('jobs', 'list', 'string')),
        new DcrEvent('print', ['Operator', 'Printer'], ['Viewer'], [], []),
        new DcrEvent('scan', ['Operator'], [], [], [])
    ];
    g.groups = [new DcrGroup('Data', ['speed', 'Person.age', 'ready', 'jobs'])];
    g.relations = [
        new DcrRelation('Data', 'print', 'speed > 2 and Person.age >= 18 and ready = true', 'condition'),
        new DcrRelation('print', 'scan', undefined, 'include'),
        new DcrRelation('print', 'print', 'speed < 1', 'response'),
        new DcrRelation('scan', 'print', 'file = "Person.age > 1" and speed != 5', 'exclude')
    ];
    return g;
}

describe('DCR Solutions XML', () => {
    it('writes the events with their names, roles, marking and position', async () => {
        const xml = await solutionsXml(graph());
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dcrgraph>')).toBe(true);
        // the names: labels, mapped to the events
        expect(xml).toContain('<label id="print"/>');
        expect(xml).toContain('<labelMapping eventId="Person_age" labelId="Person.age"/>');
        // the initiators as roles, the observers as readRoles
        expect(xml).toMatch(/<event id="Event_5">\s*<custom>\s*<roles>\s*<role>Operator<\/role>\s*<role>Printer<\/role>\s*<\/roles>\s*<readRoles>\s*<readRole>Viewer<\/readRole>\s*<\/readRoles>/);
        expect(xml).not.toMatch(/<event id="Event_6">\s*<custom>\s*<roles>[\s\S]*?<readRoles>/);
        // the group as a nesting around its events
        expect(xml).toMatch(/<event id="Nesting_1" type="nesting">[\s\S]*?<event id="speed">[\s\S]*?<\/event>\s*<event id="Person_age">/);
        // the marking: the data properties are included at the start, by their ids (a list has no data, so no id of its name)
        expect(xml).toMatch(/<included>\s*<event id="speed"\/>\s*<event id="Person_age"\/>\s*<event id="ready"\/>\s*<event id="Event_4"\/>\s*<\/included>/);
        expect(xml).toMatch(/<executed\/>/);
        expect(xml).toMatch(/<pendingResponses\/>/);
        // where it is drawn
        expect(xml).toMatch(/<location xLoc="\d+(\.\d+)?" yLoc="\d+(\.\d+)?"\/>\s*<size width="130" height="150"\/>/);
    });

    it('writes the data of a data property under the id a guard names it by', async () => {
        const xml = await solutionsXml(graph());
        expect(xml).toMatch(solutionsData('speed', 'int'));
        expect(xml).toMatch(solutionsData('Person_age', 'int'));
        expect(xml).toMatch(solutionsData('ready', 'bool'));
        // a list has no type to write, an action has no data
        expect(xml).toContain('<labelMapping eventId="Event_4" labelId="jobs"/>');
        expect(xml).not.toMatch(/<event id="Event_4">[\s\S]*?<eventData/);
        expect(xml).not.toMatch(/<event id="Event_5">(?:(?!<\/event>)[\s\S])*<eventData/);
    });

    it('writes the data as dcrgraphs.net does: a dataType numbered by the event, a boolean a choice of true and false', async () => {
        const xml = await solutionsXml(graph());
        // the nesting is 1, its events 2 to 5
        expect(xml).toMatch(solutionsData('speed', 'int', 2));
        expect(xml).toMatch(solutionsData('Person_age', 'int', 3));
        expect(xml).toContain([
            '<eventData>',
            '  <dataType sequence="4" width="small" placeholder="" hinttext="" dataSetList="" radio="horizontal" multiple="false" format="bool">choice</dataType>',
            '  <dictionary>',
            '    <item label="True" value="true"/>',
            '    <item label="False" value="false"/>',
            '  </dictionary>',
            '  <validationRules/>',
            '  <styles/>',
            '</eventData>'
        ].map(line => `              ${line}`).join('\n'));
        expect(xml).toContain([
            '<eventData>',
            '  <dataType sequence="2" width="small" min="NaN" max="NaN" placeholder="" hinttext="">int</dataType>',
            '  <validationRules/>',
            '  <styles/>',
            '</eventData>'
        ].map(line => `              ${line}`).join('\n'));
        expect(xml).not.toContain('<eventData name=');
    });

    it('writes a string as text, and Any (any value) as text too', async () => {
        const g = new DcrGraph();
        g.events = [
            new DcrEvent('name', ['Person'], [], [], [], true, new DataProperty('name', 'string')),
            new DcrEvent('note', ['Person'], [], [], [], true, new DataProperty('note', 'Any')),
            new DcrEvent('greet', ['Clerk'], [], [{ name: 'greeting', type: 'Any' }], []),
            new DcrEvent('file', ['Clerk'], [], [{ name: 'document', type: 'Any' }, { name: 'copies', type: 'int' }], [])
        ];
        g.groups = [new DcrGroup('Data', ['name', 'note'])];
        g.relations = [
            new DcrRelation('Data', 'greet', 'name = "Ann" and note = "x"', 'condition'),
            new DcrRelation('greet', 'file', 'greeting = "hi"', 'include'),
            new DcrRelation('file', 'greet', 'document = "a.pdf"', 'exclude')
        ];
        const xml = await solutionsXml(g);
        expect(xml).toMatch(solutionsData('name', 'text', 2));
        expect(xml).toMatch(solutionsData('note', 'text', 3));
        // an action's only parameter of type Any, and the parameter event of one with several
        expect(xml).toMatch(solutionsData('greet', 'text', 4));
        expect(xml).toMatch(solutionsData('file_document', 'text', 6));
        expect(xml).toContain('value="greet = &quot;hi&quot;"');
        expect(xml).toContain('value="file_document = &quot;a.pdf&quot;"');
    });

    it('writes each guard as an expression its relation names, with the data by its id', async () => {
        const xml = await solutionsXml(graph());
        expect(xml).toContain('<expression id="Relation_1-guard" value="speed &gt; 2 and Person_age &gt;= 18 and ready = true"/>');
        expect(xml).toContain('<expression id="Relation_3-guard" value="speed &lt; 1"/>');
        // the text of a string is not a name
        expect(xml).toContain('<expression id="Relation_4-guard" value="file = &quot;Person.age &gt; 1&quot; and speed != 5"/>');
        expect(xml).not.toContain('&#62;');
        expect(xml).toMatch(/<condition sourceId="Nesting_1" targetId="Event_5" expressionId="Relation_1-guard">/);
        expect(xml).toMatch(/<response sourceId="Event_5" targetId="Event_5" expressionId="Relation_3-guard">/);
        expect(xml).toMatch(/<exclude sourceId="Event_6" targetId="Event_5" expressionId="Relation_4-guard">/);
        // a relation without a guard names none, and the guard is not an attribute
        expect(xml).toMatch(/<include sourceId="Event_5" targetId="Event_6">\s*<custom>/);
        expect(xml).not.toMatch(/ guard=/);
        expect(xml.match(/<expression /g)).toHaveLength(3);
    });

    it('writes the relations under their constraint, with their waypoints', async () => {
        const xml = await solutionsXml(graph());
        expect(xml).toMatch(/<includes>\s*<include sourceId="Event_5" targetId="Event_6">\s*<custom>\s*<waypoints>\s*<waypoint x="\d+(\.\d+)?" y="\d+(\.\d+)?"\/>/);
        expect(xml).toMatch(/<id id="Relation_2"\/>/);
        expect(xml).toMatch(/<milestones\/>/);
    });

    it('keeps the ids of the data apart: from each other and from the other elements', async () => {
        const g = new DcrGraph();
        g.events = [
            new DcrEvent('Person.age', ['Person'], [], [], [], true, new DataProperty('age', 'int')),
            new DcrEvent('Person_age', ['Tray'], [], [], [], true, new DataProperty('age', 'int')),
            new DcrEvent('go', [], [], [], []),
            new DcrEvent('Event_3', ['Tray'], [], [], [], true, new DataProperty('level', 'int'))
        ];
        g.relations = [new DcrRelation('go', 'go', 'Person.age > Person_age and Event_3 > 1', 'response')];
        const xml = await solutionsXml(g);
        expect(xml).toMatch(solutionsData('Person_age', 'int'));
        expect(xml).toMatch(solutionsData('Person_age_2', 'int'));
        // a data event named like the id of another event (the action 'go' is Event_3) does not take it
        expect(xml).toContain('<event id="Event_3">\n          <custom>\n            <visualization>');
        expect(xml).toMatch(solutionsData('Event_3_2', 'int'));
        expect(xml).toContain('value="Person_age &gt; Person_age_2 and Event_3_2 &gt; 1"');
    });

    it('is the viewer\'s saveDCRXML: rejects without definitions', async () => {
        await expect(saveDCRXML({}, undefined)).rejects.toThrow('no definitions loaded');
    });
});

/** The care-allowance model's actions, whose inputs and outputs the guards name: result, satisfied, caregivers. */
function careGraph(): DcrGraph {
    const g = new DcrGraph();
    const input = (name: string, type: 'int' | 'string' | 'boolean') => ({ name, type });
    g.events = [
        new DcrEvent('submit information', ['Citizen'], ['System robot'], [input('age', 'int'), input('certificate', 'string'), input('caregivers', 'int')], []),
        new DcrEvent('determine minority', ['System robot'], [], [], [input('result', 'boolean')]),
        new DcrEvent('verify certificate', ['System robot'], [], [], [input('result', 'boolean')]),
        new DcrEvent('assess work absence', ['Caseworker'], [], [input('satisfied', 'boolean')], []),
        new DcrEvent('assess second caregiver', ['Caseworker'], [], [input('satisfied', 'boolean')], []),
        new DcrEvent('reject application', ['Caseworker'], [], [], [])
    ];
    g.relations = [
        new DcrRelation('submit information', 'assess second caregiver', 'caregivers = 1', 'exclude'),
        new DcrRelation('determine minority', 'reject application', 'result = false and caregivers = 2', 'include'),
        new DcrRelation('verify certificate', 'reject application', 'result = false', 'include'),
        new DcrRelation('assess work absence', 'reject application', 'satisfied = false and note = "satisfied"', 'include'),
        new DcrRelation('assess second caregiver', 'reject application', 'satisfied = false', 'include'),
        new DcrRelation('submit information', 'reject application', undefined, 'include')
    ];
    return g;
}

describe('DCR Solutions XML of an action\'s data', () => {
    it('names the only input or output of an action by the action\'s id, in the guards of its relations', async () => {
        const xml = await solutionsXml(careGraph());
        // the action carries its data, under the id its guards name
        expect(xml).toMatch(solutionsData('determine_minority', 'bool'));
        expect(xml).toMatch(solutionsData('verify_certificate', 'bool'));
        expect(xml).toMatch(solutionsData('assess_work_absence', 'bool'));
        expect(xml).toMatch(solutionsData('assess_second_caregiver', 'bool'));
        // 'result' is two actions' output, and each one's guard names its own; so is 'satisfied'; a string stays
        expect(xml).toMatch(/<include sourceId="determine_minority" targetId="Event_6" expressionId="Relation_2-guard">/);
        expect(xml).toContain('value="determine_minority = false and caregivers = 2"');
        expect(xml).toContain('value="verify_certificate = false"');
        expect(xml).toContain('value="assess_work_absence = false and note = &quot;satisfied&quot;"');
        expect(xml).toContain('value="assess_second_caregiver = false"');
        expect(xml).not.toMatch(/value="[^"]*\bresult\b/);
        // the label is mapped to that id; an action is not included at the start
        expect(xml).toContain('<labelMapping eventId="determine_minority" labelId="determine minority"/>');
        expect(xml).not.toMatch(/<included>[\s\S]*?<event id="determine_minority"\/>[\s\S]*?<\/included>/);
    });

    it('gives each input a guard names its own event, next to an action with several', async () => {
        const xml = await solutionsXml(careGraph());
        // caregivers is named, age and certificate are not
        expect(xml).toMatch(/<event id="submit_information_caregivers">\s*<custom>\s*<roles>\s*<role>Citizen<\/role>\s*<\/roles>\s*<visualization>\s*<location xLoc="\d+" yLoc="\d+"\/>\s*<size width="130" height="150"\/>\s*<\/visualization>\s*<eventData>\s*<dataType sequence="\d+" width="small" min="NaN" max="NaN" placeholder="" hinttext="">int<\/dataType>\s*<validationRules\/>\s*<styles\/>\s*<\/eventData>/);
        expect(xml).not.toContain('submit_information_age');
        expect(xml).not.toContain('submit_information_certificate');
        expect(xml).toContain('<labelMapping eventId="submit_information_caregivers" labelId="submit information caregivers"/>');
        expect(xml).toMatch(/<included>[\s\S]*?<event id="submit_information_caregivers"\/>/);
        // the action keeps its id, with no data of its own
        expect(xml).toMatch(/<event id="Event_1">[\s\S]*?<\/event>\s*<event id="submit_information_caregivers">/);
        expect(xml).not.toMatch(/<event id="Event_1">(?:(?!<\/event>)[\s\S])*<eventData/);
        // its guard, and only the guards of its own relations (the other action's 'caregivers' stays as written)
        expect(xml).toContain('value="submit_information_caregivers = 1"');
        expect(xml).toContain('value="determine_minority = false and caregivers = 2"');
    });

    it('keeps the ids apart: from the other data and the other elements', async () => {
        const g = careGraph();
        g.events.push(new DcrEvent('determine_minority', ['Tray'], [], [], [], true, new DataProperty('determine_minority', 'int')));
        const xml = await solutionsXml(g);
        expect(xml.match(/<event id="determine_minority">/g)).toHaveLength(1);
        expect(xml).toMatch(solutionsData('determine_minority', 'bool'));
        expect(xml).toMatch(solutionsData('determine_minority_2', 'int'));
    });
});

describe('dcr-js XML', () => {
    it('is drawn with the data and the guards as they are written', async () => {
        const definitions = await definitionsOf((await toDcrXml(graph())).xml);
        const { xml } = await Moddle().toXML(definitions, { format: true });
        const { rootElement, warnings } = await Moddle().fromXML(xml, 'dcr:Definitions');
        expect(warnings).toEqual([]);
        const events = rootElement.rootElements[0].boardElements;
        const age = events[0].boardElements.find((event: any) => event.description === 'Person.age');
        expect(age.eventData).toMatchObject({ name: 'Person.age', type: 'Int' });
        expect(events[0].boardElements.find((event: any) => event.description === 'ready').eventData).toMatchObject({ type: 'Bool' });
        expect(events.find((event: any) => event.description === 'print').eventData).toBeUndefined();
        expect(events.find((event: any) => event.guard === 'speed < 1')).toBeDefined();
    });
});

describe('dcr-js XML export', () => {
    it('names the data of a data property by an identifier, in the guards too', async () => {
        const xml = await dcrJsXml(graph());
        expect(xml).toContain('<dcr:eventData name="speed" type="Int" />');
        expect(xml).toContain('<dcr:eventData name="Person_age" type="Int" />');
        expect(xml).toContain('<dcr:eventData name="ready" type="Bool" />');
        expect(xml).toContain('guard="speed &#62; 2 and Person_age &#62;= 18 and ready = true"');
        // a string literal stays as it is, and so does a name without data (a list)
        expect(xml).toContain('guard="file = &#34;Person.age &#62; 1&#34; and speed != 5"');
        expect(xml).not.toContain('name="Person.age"');
        // everything else is as drawn: the ids, the names, the layout
        expect(xml).toContain('<dcr:event id="Event_2" initiators="Person" description="Person.age"');
        expect(xml).toMatch(/<dcrDi:dcrShape id="Event_2_di" boardElement="Event_2">/);
    });

    it('names data with a space in its name by an identifier: the care allowance guards', async () => {
        const g = new DcrGraph();
        g.events = [
            new DcrEvent('certificate genuine', ['Care application'], [], [], [], true, new DataProperty('certificate genuine', 'boolean')),
            new DcrEvent('insurance member', ['Care application'], [], [], [], true, new DataProperty('insurance member', 'boolean')),
            new DcrEvent('open case', ['Caseworker'], [], [], [])
        ];
        g.groups = [new DcrGroup('Data', ['certificate genuine', 'insurance member'])];
        g.relations = [new DcrRelation('Data', 'open case', 'certificate genuine = true and insurance member = true', 'condition')];
        const xml = await dcrJsXml(g);
        expect(xml).toContain('<dcr:eventData name="certificate_genuine" type="Bool" />');
        expect(xml).toContain('<dcr:eventData name="insurance_member" type="Bool" />');
        expect(xml).toContain('guard="certificate_genuine = true and insurance_member = true"');
        expect(xml).toContain('description="certificate genuine"');
        expectGuardsToNameData(xml);
    });

    it('names the only input or output of an action by the action, and gives each named input of an action with several its own event', async () => {
        const xml = await dcrJsXml(careGraph());
        // the action carries its data, under the identifier of its name; each action's guard names its own
        expect(xml).toMatch(/<dcr:event id="Event_2" [^>]*description="determine minority"[^>]*>\s*<dcr:eventData name="determine_minority" type="Bool" \/>/);
        expect(xml).toMatch(/<dcr:event id="Event_3" [^>]*description="verify certificate"[^>]*>\s*<dcr:eventData name="verify_certificate" type="Bool" \/>/);
        expect(xml).toContain('guard="determine_minority = false and caregivers = 2"');
        expect(xml).toContain('guard="verify_certificate = false"');
        expect(xml).toContain('guard="assess_work_absence = false and note = &#34;satisfied&#34;"');
        expect(xml).toContain('guard="assess_second_caregiver = false"');
        expect(xml).not.toMatch(/guard="[^"]*\bresult\b/);
        // caregivers is named by a guard of submit information, age and certificate are not: its event is right after the action, included, with its initiators
        expect(xml).toMatch(/<dcr:event id="Event_1" initiators="Citizen" observers="System robot" parameters="age:int, certificate:string, caregivers:int" description="submit information" included="false" executed="false" pending="false" enabled="false" \/>\s*<dcr:event id="submit_information_caregivers" initiators="Citizen" description="submit information caregivers" included="true" executed="false" pending="false" enabled="false">\s*<dcr:eventData name="submit_information_caregivers" type="Int" \/>/);
        expect(xml).not.toContain('submit_information_age');
        expect(xml).not.toContain('submit_information_certificate');
        expect(xml).toContain('guard="submit_information_caregivers = 1"');
        // drawn below the action, as high as an event
        const action = xml.match(/<dcrDi:dcrShape id="Event_1_di" boardElement="Event_1">\s*<dc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/)!;
        const [x, y, width, height] = action.slice(1).map(Number);
        expect(xml).toMatch(new RegExp(`<dcrDi:dcrShape id="submit_information_caregivers_di" boardElement="submit_information_caregivers">\\s*<dc:Bounds x="${x}" y="${y + height + 40}" width="${width}" height="150" />`));
        // the one name no event has data for is the other action's 'caregivers' (not its own: left as written)
        const data = [...xml.matchAll(/<dcr:eventData name="([^"]*)"/g)].map(m => m[1]);
        expect(data).toEqual(['determine_minority', 'verify_certificate', 'assess_work_absence', 'assess_second_caregiver', 'submit_information_caregivers'].sort((a, b) => data.indexOf(a) - data.indexOf(b)));
    });

    it('keeps the names apart, and leaves what is drawn as it is', async () => {
        const g = careGraph();
        g.events.push(new DcrEvent('determine_minority', ['Tray'], [], [], [], true, new DataProperty('determine_minority', 'int')));
        g.relations.push(new DcrRelation('determine_minority', 'reject application', 'determine_minority > 1', 'exclude'));
        const definitions = await definitionsOf((await toDcrXml(g)).xml);
        const moddle = Moddle();
        const before = (await moddle.toXML(definitions, { format: true })).xml;
        const { xml } = await saveDcrJsXML({ format: true }, definitions, moddle);
        expect(xml).toContain('<dcr:eventData name="determine_minority" type="Bool" />');
        expect(xml).toContain('<dcr:eventData name="determine_minority_2" type="Int" />');
        expect(xml).toContain('guard="determine_minority_2 &#62; 1"');
        expect((await moddle.toXML(definitions, { format: true })).xml).toEqual(before);
    });

    it('is the viewer\'s saveDcrJsXML: rejects without definitions', async () => {
        await expect(saveDcrJsXML({}, undefined, Moddle())).rejects.toThrow('no definitions loaded');
    });
});
