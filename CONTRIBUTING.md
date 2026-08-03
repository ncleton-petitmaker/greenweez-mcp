# Contribuer à Greenweez MCP

Merci de contribuer. Ce projet est un connecteur non officiel : la sûreté des mutations et la confidentialité priment sur la compatibilité implicite.

## Préparer une modification

1. Créez une branche à partir de `main`.
2. Ne placez jamais de compte, cookie, jeton, adresse, panier, commande, capture ou identifiant personnel dans le dépôt, les tests ou une issue.
3. Faites échouer explicitement le connecteur si un contrat Greenweez observé n’est plus reconnu. N’ajoutez ni réponse fictive ni contournement d’authentification.
4. Pour toute mutation, conservez prévisualisation, confirmation liée à l’état, sérialisation et vérification après écriture.

## Valider localement

```sh
npm ci
npm run verify
```

`dist/` fait partie de la distribution GitHub directe. Après toute modification TypeScript, exécutez `npm run build` et incluez les fichiers compilés correspondants. La CI refuse un répertoire `dist/` désynchronisé.

## Publier une release GitHub

1. Vérifiez que `package.json` contient la version cible, par exemple `0.2.1`.
2. Exécutez `npm run verify` puis `npm run release:check`.
3. Commitez et poussez `main` sans réécrire l’historique.
4. Créez et poussez le tag correspondant : `v0.2.1`.

Le workflow de release relance toutes les validations et joint le paquet npm vérifié à la release GitHub. Il ne publie pas sur npm ; l’installation publique reste volontairement basée sur les tags GitHub.

## Compatibilité des agents

`AGENTS.md` est la source de vérité pour Codex. `CLAUDE.md` l’importe pour Claude Code : toute règle se modifie une seule fois.
