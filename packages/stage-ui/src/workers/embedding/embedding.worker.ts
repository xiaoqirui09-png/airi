import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import { closeEmbedder, embedTexts } from './embedding-events'
import { EmbeddingModel } from './embedding-model'

// The model loads on the first embed, not on Worker start, so opening the Worker is cheap.
const model = new EmbeddingModel()
const { context } = createContext()

defineInvokeHandler(context, embedTexts, ({ texts, config }, options) => model.embed(texts, config, options?.abortController?.signal))
defineInvokeHandler(context, closeEmbedder, () => model.close())
