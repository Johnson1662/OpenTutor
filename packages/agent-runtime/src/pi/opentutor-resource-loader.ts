import {
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { SOCRATIC_TUTOR_SYSTEM_PROMPT } from '../prompt.ts';
import {
  createOpenTutorExtension,
  type OpenTutorExtensionOptions,
} from './opentutor-extension.ts';

export interface OpenTutorResourceLoaderOptions {
  cwd?: string;
  extensionOptions: OpenTutorExtensionOptions;
}

export async function createOpenTutorResourceLoader(
  options: OpenTutorResourceLoaderOptions
): Promise<DefaultResourceLoader> {
  const cwd = options.cwd ?? process.cwd();
  const settingsManager = SettingsManager.inMemory({
    retry: { enabled: true, maxRetries: 2 },
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    noExtensions: true,
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      {
        name: 'opentutor',
        factory: createOpenTutorExtension(options.extensionOptions),
      },
    ],
    systemPromptOverride: () => SOCRATIC_TUTOR_SYSTEM_PROMPT,
    settingsManager,
  });

  await resourceLoader.reload();
  return resourceLoader;
}
