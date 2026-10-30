// The DCR page of legal-dcr-frontend (its COMPONENT.md), as `npm run dcr-page` builds it into
// legal-dcr-frontend/app/dist-component, which vite.config.ts names dcr-page/.

declare module 'dcr-page/dcr-page.js' {
    export type ModelerOption = 'newDiagram' | 'open' | 'examples' | 'simulation' | 'layout';

    export interface DcrPageOptions {
        hiddenOptions?: Iterable<ModelerOption>;
        embedded?: boolean;
        markerNotation?: 'HM2011' | 'DCR Solutions' | 'TAL2023';
        coloredRelations?: boolean;
        checksGuards?: boolean;
    }

    export interface DcrPageHandle {
        show(xml: string, name?: string): Promise<string[]>;
        xml(): Promise<string>;
        fit(): void;
        resized(): void;
        destroy(): void;
    }

    export function mountDcrPage(element: HTMLElement, options?: DcrPageOptions): DcrPageHandle;
}

declare module 'dcr-page/dcr-page.css';
