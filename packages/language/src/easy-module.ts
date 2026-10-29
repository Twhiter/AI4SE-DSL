import { type Module, inject } from 'langium';
import { createDefaultModule, createDefaultSharedModule, type DefaultSharedModuleContext, type LangiumServices, type LangiumSharedServices, type PartialLangiumServices } from 'langium/lsp';
import { EasyGeneratedModule, EasyGeneratedSharedModule } from './generated/module.js';
import { EasyValidator, registerValidationChecks } from './easy-validator.js';
import { EasyLinker, EasyScopeComputation, EasyScopeProvider, EasyValueConverter } from './easy-dsl-services.js';
import { EasyParserErrorMessageProvider } from './easy-parser.js';

/** The services this language adds to Langium's. */
export type EasyAddedServices = {
    validation: {
        EasyValidator: EasyValidator
    }
}

/** Langium's services and the added ones: the constructor parameter of custom service classes. */
export type EasyServices = LangiumServices & EasyAddedServices

/** Overrides Langium's default services where needed, and contributes the added ones. */
export const EasyModule: Module<EasyServices, PartialLangiumServices & EasyAddedServices> = {
    validation: {
        EasyValidator: () => new EasyValidator()
    },
    references: {
        ScopeComputation: (services) => new EasyScopeComputation(services),
        ScopeProvider: (services) => new EasyScopeProvider(services),
        Linker: (services) => new EasyLinker(services)
    },
    parser: {
        ValueConverter: () => new EasyValueConverter(),
        ParserErrorMessageProvider: (services) => new EasyParserErrorMessageProvider(services)
    }
};

/**
 * All services of the language: Langium's defaults, the generated ones and those in EasyModule.
 * @param context the LSP connection and file system, or EmptyFileSystem outside a language server
 */
export function createEasyServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    Easy: EasyServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        EasyGeneratedSharedModule
    );
    const Easy = inject(
        createDefaultModule({ shared }),
        EasyGeneratedModule,
        EasyModule
    );
    shared.ServiceRegistry.register(Easy);
    registerValidationChecks(Easy);
    if (!context.connection) {
        // not in a language server: initialize the configuration provider right away
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, Easy };
}
