import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface AiAutocompleteOptions {
  suggestionClassName: string;
}

export interface AiAutocompleteStorage {
  suggestion: string | null;
  loading: boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiAutocomplete: {
      setAiSuggestion: (suggestion: string) => ReturnType;
      clearAiSuggestion: () => ReturnType;
      acceptAiSuggestion: () => ReturnType;
    };
  }
}

export const AiAutocomplete = Extension.create<AiAutocompleteOptions, AiAutocompleteStorage>({
  name: 'aiAutocomplete',

  addOptions() {
    return {
      suggestionClassName: 'ai-autocomplete-suggestion',
    };
  },

  addStorage() {
    return {
      suggestion: null,
      loading: false,
    };
  },

  addCommands() {
    return {
      setAiSuggestion:
        (suggestion: string) =>
        ({ tr, dispatch }) => {
          this.storage.suggestion = suggestion;
          // Force re-render of decorations
          if (dispatch) dispatch(tr.setMeta('aiAutocomplete', { type: 'update' }));
          return true;
        },
      clearAiSuggestion:
        () =>
        ({ tr, dispatch }) => {
          this.storage.suggestion = null;
          if (dispatch) dispatch(tr.setMeta('aiAutocomplete', { type: 'clear' }));
          return true;
        },
      acceptAiSuggestion:
        () =>
        ({ commands }) => {
          if (this.storage.suggestion) {
            const suggestion = this.storage.suggestion;
            this.storage.suggestion = null;
            return commands.insertContent(suggestion);
          }
          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.storage.suggestion) {
          return this.editor.commands.acceptAiSuggestion();
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('aiAutocomplete'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply: (tr, _oldState) => {
            // If document changed, clear suggestion (unless it was our own insert)
            if (tr.docChanged && !tr.getMeta('aiAutocomplete')) {
              this.storage.suggestion = null;
              return DecorationSet.empty;
            }

            // If we have a suggestion, create decoration
            const suggestion = this.storage.suggestion;
            if (suggestion) {
              const { to } = tr.selection;
              // Only show if cursor is at end of document
              // Logic is handled in React component for triggering, 
              // here we just render if present.
              
              const decoration = Decoration.widget(to, () => {
                const span = document.createElement('span');
                span.setAttribute('data-suggestion', suggestion);
                span.className = this.options.suggestionClassName;
                return span;
              }, { side: 1 });

              return DecorationSet.create(tr.doc, [decoration]);
            }

            return DecorationSet.empty;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
