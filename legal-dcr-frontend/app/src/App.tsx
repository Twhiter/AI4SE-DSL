import { useCallback, useMemo, useState } from "react";
import type DCRModeler from "modeler";
import ModelerState, { type ModelerOption } from "./components/ModelerState";
import SimulatorState from "./components/SimulatorState";
import type { EventLog, RoleTrace } from "dcr-engine";
import {
  isColoredRelations,
  isMarkerNotation,
  type ColoredRelations,
  type MarkerNotation,
} from "./types";

export const StateEnum = {
  Modeler: "Modeler",
  Simulator: "Simulator",
} as const;

export type StateEnum = (typeof StateEnum)[keyof typeof StateEnum];

export interface DCRGraphEntry {
  name: string;
  graph: string;
}

export interface EventLogEntry {
  name: string;
  log: EventLog<RoleTrace>;
}

export type DCRGraphRepository = Map<string, DCRGraphEntry>;

export type EventLogRepository = Map<string, EventLogEntry>;

export interface StateProps {
  setState: (state: StateEnum) => void;
  savedGraphs: DCRGraphRepository;
  savedLogs: EventLogRepository;
  currentGraph: DCRGraphEntry | null;
  draftGraph: DCRGraphEntry | null;
  openDraftGraph: (
    name: string,
    graph: string,
    destination?: StateEnum,
    preserveCurrent?: boolean,
  ) => void;
  currentLog: EventLogEntry | null;
  saveGraph: (name: string, graph: string, createNew?: boolean) => boolean;
  saveLog: (name: string, log: EventLog<RoleTrace>) => boolean;
  pickGraph: (name?: string | null) => void;
  markerNotation: MarkerNotation;
  changeMarkerNotation: (value: unknown) => void;
  coloredRelations: ColoredRelations;
  changeColoredRelations: (value: unknown) => void;
}

export interface AppProps {
  /** A graph given from outside, as DCR.js editor XML: shown at the start, and again whenever it changes. */
  graph?: DCRGraphEntry;
  /** Inside an element of another page, rather than the whole window. */
  embedded?: boolean;
  /** The options of the DCR page to hide and disable. */
  hiddenOptions?: ReadonlySet<ModelerOption>;
  /** How relations are drawn, and whether they are coloured, at the start. */
  markerNotation?: MarkerNotation;
  coloredRelations?: ColoredRelations;
  /** Whether Save, Download and Simulation first check the guards (DCR.js's guard syntax, declared variables). */
  checksGuards?: boolean;
  /** The DCR page's editor whenever it changes, and null when it goes. */
  onModeler?: (modeler: DCRModeler | null) => void;
}

const App = ({
  graph,
  embedded,
  hiddenOptions,
  markerNotation: initialMarkerNotation = "HM2011",
  coloredRelations: initialColoredRelations = true,
  checksGuards,
  onModeler,
}: AppProps) => {
  const [state, setState] = useState<StateEnum>(StateEnum.Modeler);

  const [markerNotation, setMarkerNotation] =
    useState<MarkerNotation>(initialMarkerNotation);

  const [coloredRelations, setColoredRelations] =
    useState<ColoredRelations>(initialColoredRelations);

  // Saved graphs and logs are kept in memory, until the page is reloaded.
  const [graphs, setGraphs] = useState<DCRGraphRepository>(new Map());
  const [logs, setLogs] = useState<EventLogRepository>(new Map());

  const [currentGraphName, setCurrentGraphName] = useState<string | null>(null);
  const [draftGraph, setDraftGraph] = useState<DCRGraphEntry | null>(null);
  const [currentLogName, setCurrentLogName] = useState<string | null>(null);

  const currentGraph = useMemo(() => {
    if (currentGraphName === null) {
      return null;
    }

    return graphs.get(currentGraphName) ?? null;
  }, [graphs, currentGraphName]);

  const currentLog = useMemo(() => {
    if (currentLogName === null) {
      return null;
    }

    return logs.get(currentLogName) ?? null;
  }, [logs, currentLogName]);

  // Saves the current graph under the name, renaming it if the name changed, or, with createNew, a new graph.
  const saveGraph = useCallback(
    (name: string, graph: string, createNew = false) => {
      const normalizedName = name.trim();
      if (!normalizedName) {
        window.alert("Enter a name for the DCR graph.");
        return false;
      }
      const previousName = createNew ? null : currentGraphName;
      if (
        graphs.has(normalizedName) &&
        normalizedName !== previousName &&
        !window.confirm("Overwrite existing graph?")
      ) {
        return false;
      }
      setGraphs((prev) => {
        const newMap = new Map(prev);
        if (previousName !== null) {
          newMap.delete(previousName);
        }
        newMap.set(normalizedName, { name: normalizedName, graph });
        return newMap;
      });
      setCurrentGraphName(normalizedName);
      setDraftGraph(null);
      return true;
    },
    [graphs, currentGraphName],
  );

  const saveLog = useCallback(
    (name: string, log: EventLog<RoleTrace>) => {
      if (
        !logs.has(name) ||
        name === currentLogName ||
        window.confirm("Overwrite existing log?")
      ) {
        setLogs((prev) => {
          const newMap = new Map(prev);
          newMap.set(name, { name, log });
          return newMap;
        });
        setCurrentLogName(name);
        return true;
      }
      return false;
    },
    [logs, currentLogName],
  );

  const pickGraph = useCallback(
    (name: string | null = null) => {
      if (name && !graphs.has(name)) {
        window.alert("Graph not found!");
        return;
      }
      setCurrentGraphName(name);
      setDraftGraph(null);
    },
    [graphs],
  );

  const openDraftGraph = useCallback((
    name: string,
    graph: string,
    destination: StateEnum = StateEnum.Modeler,
    preserveCurrent = false,
  ) => {
    if (!preserveCurrent) setCurrentGraphName(null);
    setDraftGraph({ name, graph });
    setState(destination);
  }, []);

  const changeMarkerNotation = useCallback((value: unknown) => {
    if (isMarkerNotation(value)) {
      setMarkerNotation(value);
    }
  }, []);

  const changeColoredRelations = useCallback((value: unknown) => {
    if (isColoredRelations(value)) {
      setColoredRelations(value);
    }
  }, []);

  const stateProps: StateProps = {
    setState,
    savedGraphs: graphs,
    savedLogs: logs,
    currentGraph,
    draftGraph,
    openDraftGraph,
    currentLog,
    saveGraph,
    saveLog,
    pickGraph,
    markerNotation,
    changeMarkerNotation,
    coloredRelations,
    changeColoredRelations,
  };

  switch (state) {
    case StateEnum.Modeler:
      return (
        <ModelerState
          {...stateProps}
          initialGraph={graph}
          embedded={embedded}
          hiddenOptions={hiddenOptions}
          checksGuards={checksGuards}
          onModeler={onModeler}
        />
      );
    case StateEnum.Simulator:
      return <SimulatorState {...stateProps} />;
  }
};

export default App;
