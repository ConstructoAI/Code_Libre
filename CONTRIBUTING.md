# Contribuer à Constructo AI

Merci de votre intérêt pour Constructo AI ! Ce document décrit comment proposer une contribution efficace et acceptable.

## Code de conduite

Toute participation au projet est soumise au [Code de conduite](CODE_OF_CONDUCT.md). En contribuant, vous acceptez de respecter ses termes.

## Comment contribuer

### 1. Signaler un bug

Avant d'ouvrir un nouveau ticket, vérifiez qu'un ticket similaire n'existe pas déjà dans les [issues](https://github.com/ConstructoAI/Code_Libre/issues). Si ce n'est pas le cas, utilisez le **template de bug report** : il guide pour fournir la version, les étapes de reproduction, le comportement attendu vs observé, et l'environnement (OS, navigateur, version Python/Node).

### 2. Proposer une nouvelle fonctionnalité

Utilisez le **template de feature request**. Décrivez :
- Le problème métier que vous cherchez à résoudre (qui, quand, pourquoi)
- La solution proposée (et alternatives envisagées)
- L'impact sur la conformité québécoise (RBQ, CCQ, CNESST, Loi 16, Loi 25) si pertinent

Pour les fonctionnalités importantes, ouvrez une **issue de discussion** avant de coder — cela évite qu'un PR soit refusé pour incompatibilité d'approche.

### 3. Soumettre du code

```bash
# 1. Forker le dépôt sur GitHub, puis cloner votre fork
git clone https://github.com/<votre-utilisateur>/Code_Libre.git
cd Code_Libre

# 2. Créer une branche de fonctionnalité
git checkout -b feature/ma-fonctionnalite

# 3. Faire vos changements, puis valider localement
pytest                                              # tests Python
cd ERP_REACT/frontend && npm run typecheck          # vérification TypeScript
npm run build                                       # vérification build
npm run lint                                        # vérification lint

# 4. Commit (en français, message clair)
git add .
git commit -m "feat: description courte de la fonctionnalité"

# 5. Pousser vers votre fork et ouvrir une PR sur GitHub
git push origin feature/ma-fonctionnalite
```

## Style de code

### Python (backends + modules partagés)

- **PEP 8** appliqué (longueur de ligne 100 caractères tolérée)
- **Type hints** obligatoires pour les nouvelles fonctions publiques
- **Pydantic v2** pour les schémas de requête/réponse FastAPI
- **Docstrings** au format Google ou NumPy pour les fonctions complexes
- Pas de `print()` en production — utiliser le `logger` du module

### TypeScript / React (frontends)

- **TypeScript strict** activé — pas de `any` implicite
- **React 18** — composants fonctionnels uniquement, pas de classes
- **Zustand** pour le state global, `useState`/`useReducer` pour le state local
- **Tailwind CSS** pour le styling, classes utilitaires plutôt que CSS custom
- **ESLint** + **Prettier** doivent passer sans warning

### Commits

Le projet ne force pas Conventional Commits, mais préfère ce style pour la lisibilité :

- `feat: …` — nouvelle fonctionnalité
- `fix: …` — correction de bug
- `docs: …` — modification de documentation
- `refactor: …` — refactorisation sans changement de comportement
- `test: …` — ajout ou modification de tests
- `chore: …` — tâche de maintenance (dépendances, CI, etc.)
- `deps: …` — mise à jour d'une dépendance

Messages en **français** acceptés et même préférés (le projet cible le Québec).

## Tests

### Tests obligatoires avant PR

- **Backend** : `pytest` sans erreur
- **Frontend** : `npm run typecheck` et `npm run build` sans erreur
- **Sécurité** : aucun secret hardcodé (le CI Gitleaks bloquera sinon)

### Couverture de tests

La couverture pytest est mesurée via `pytest --cov`. Les contributions importantes doivent maintenir ou améliorer la couverture, particulièrement sur :
- Authentification, autorisation, multi-tenant
- Calculs financiers (taxes, paie, factures)
- Validation de données utilisateur (Pydantic, magic bytes)

### Tests de sécurité

Le fichier `ERP_REACT/backend/tests/test_code_quality.py` scanne automatiquement le code pour des patterns de secrets en dur (`sk-ant-`, `sk_live_`, etc.). Ne contournez jamais ces tests — fixez la cause racine.

## Vérifications de sécurité

Avant de pousser, **vérifiez** :

```bash
# Aucun secret dans le diff
git diff --staged

# Aucun fichier sensible ajouté
git status
# Vérifiez l'absence de : .env, *.key, *.pem, credentials.json, etc.
```

Le `.gitignore` est strict, mais une vérification manuelle reste prudente. Le CI **Gitleaks** scanne aussi l'historique complet à chaque push.

## Revue de PR

Une pull request typique reçoit une revue dans les **7 jours**. La revue vérifie :

1. ✅ Les tests passent (CI vert)
2. ✅ Le code respecte le style du projet
3. ✅ Aucun secret ou donnée sensible n'est commité
4. ✅ La fonctionnalité est documentée (commentaires de code + manuel utilisateur si UI)
5. ✅ L'impact sur la conformité québécoise est évalué (le cas échéant)
6. ✅ Les breaking changes sont signalés dans le `CHANGELOG.md`

Les PR avec test plan dans la description et captures d'écran (si UI) sont mergées plus vite.

## Licence

En contribuant, vous acceptez que votre code soit publié sous la même licence [**Apache 2.0**](LICENSE) que le reste du projet, et que votre nom puisse être ajouté au fichier [NOTICE](NOTICE) pour les contributions significatives.

## Besoin d'aide ?

- **Discussions GitHub** : pour les questions générales, brainstorming, retours d'expérience
- **Issues** : pour les bugs et les demandes de fonctionnalités précises
- **info@constructoai.ca** : pour les questions privées ou les vulnérabilités de sécurité (voir [SECURITY.md](SECURITY.md))

---

Merci de contribuer à rendre Constructo AI meilleur pour la communauté de la construction au Québec !
