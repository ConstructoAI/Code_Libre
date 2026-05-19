<!--
Merci pour votre contribution à Constructo AI !
Remplissez ce template pour faciliter la revue.
-->

## Résumé

<!-- Une ou deux phrases sur ce que fait cette PR et pourquoi. -->

## Type de changement

- [ ] 🐛 Correction de bug (changement non-breaking qui corrige un problème)
- [ ] ✨ Nouvelle fonctionnalité (changement non-breaking qui ajoute une fonctionnalité)
- [ ] 💥 Breaking change (correction ou fonctionnalité qui modifie le comportement attendu existant)
- [ ] 📝 Documentation uniquement
- [ ] ♻️ Refactorisation (pas de changement fonctionnel)
- [ ] ⚡ Performance
- [ ] 🔒 Sécurité
- [ ] 🧪 Tests
- [ ] 🔧 Maintenance (dépendances, CI, build, etc.)

## Issue liée

<!-- Si applicable : Closes #123, Fixes #456, Refs #789 -->

## Changements

<!--
Liste détaillée des modifications. Par fichier ou par fonctionnalité.
Pour les changements UI, ajoutez des captures avant/après.
-->

## Plan de test

<!--
Comment avez-vous validé que ça marche ? Et comment le reviewer peut le valider ?
Soyez précis : étapes, données de test, comportement attendu.
-->

- [ ] Tests automatisés ajoutés / mis à jour
- [ ] `pytest` passe sans erreur
- [ ] `npm run typecheck` passe sans erreur
- [ ] `npm run build` passe sans erreur
- [ ] Testé manuellement en navigateur (préciser quels écrans)
- [ ] Testé sur PostgreSQL réel (pas seulement SQLite mémoire)

## Captures d'écran (si UI)

<!-- Glisser-déposer les images. Format suggéré : Avant / Après. -->

## Checklist de sécurité

- [ ] Aucun secret hardcodé dans le code (clés API, mots de passe, tokens)
- [ ] Aucun fichier `.env`, `*.key`, `*.pem`, `credentials.json` n'a été commité
- [ ] Les nouvelles entrées utilisateur sont validées (Pydantic, magic bytes, sanitization)
- [ ] Les nouvelles requêtes SQL sont paramétrées (pas de concaténation de strings)
- [ ] L'isolation multi-tenant est respectée (search_path correct, aucune fuite entre schémas)

## Impact sur la conformité québécoise

<!-- Cocher si applicable. -->

- [ ] Modifie un calcul fiscal (TPS, TVQ, retenues)
- [ ] Modifie la paie CCQ
- [ ] Modifie la gestion des licences RBQ
- [ ] Modifie l'audit log Loi 25
- [ ] Aucun impact sur la conformité

## Breaking changes

<!--
Si cette PR introduit un breaking change :
- Quel est le comportement avant ?
- Quel est le comportement après ?
- Quelle action les utilisateurs/intégrateurs doivent prendre pour migrer ?
- Avez-vous ajouté une entrée au CHANGELOG.md ?
-->

## Notes pour le reviewer

<!--
Décisions de design qui méritent une attention particulière, alternatives écartées, suivis prévus dans des PR séparées, etc.
-->
