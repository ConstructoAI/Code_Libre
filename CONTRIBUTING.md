# Contribuer à Constructo AI

> ⚠️ **À lire avant de commencer.** Constructo AI est avant tout **le code de production de Constructo AI Inc.**, opéré en SaaS hébergé à partir de 79,99 $/mois. Sa roadmap est dictée par les besoins des clients du service hébergé. **Les contributions externes ne sont pas activement sollicitées** et la majorité des pull requests externes ne seront pas mergées.
>
> Cette politique n'est pas un signe d'hostilité — c'est une décision opérationnelle qui permet à un mainteneur solo de servir ses clients sans se disperser. Si vous êtes développeur et cherchez un projet open source à contribuer activement, des dizaines d'excellents projets construction (Frappe ERPNext, Akaunting, Twenty CRM) ont une politique d'accueil beaucoup plus ouverte.

## Quand une PR sera-t-elle considérée ?

Trois cas, et trois cas seulement :

### 🔒 1. Correctif de sécurité

- Référez-vous d'abord à [SECURITY.md](SECURITY.md) — les vulnérabilités graves ne doivent **pas** être divulguées via une PR publique
- Pour un correctif mineur déjà public ou documenté : ouvrez une PR avec lien vers le CVE/CWE/advisory et une explication claire

### 🐛 2. Correctif de bug critique

Un bug critique est défini comme :
- Une régression bloquante (la fonctionnalité ne marche plus du tout)
- Une perte de données potentielle
- Un crash systématique reproductible

La PR doit inclure :
1. Une issue préalable décrivant le bug avec étapes de reproduction
2. Un test automatisé qui échoue avant le fix et passe après
3. Un changement minimal — pas de refactoring d'opportunité

### 📝 3. Amélioration de documentation

Acceptées :
- Corrections factuelles dans le README, le manuel utilisateur, les commentaires de code
- Clarifications d'exemples qui sont incorrects ou ambigus
- Traductions (anglais, espagnol — préciser dans l'issue)

Refusées :
- Ajout de fonctionnalités non documentées
- Refonte du style/ton de la documentation existante

## Avant d'ouvrir une PR

**Ouvrez une [Discussion GitHub](https://github.com/ConstructoAI/Code_Libre/discussions) d'abord** pour valider l'intérêt. Une PR ouverte sans discussion préalable sera vraisemblablement fermée sans revue, et c'est du temps perdu pour vous.

Dans la Discussion, précisez :
- **Quel problème** vous cherchez à résoudre (cas d'usage concret, pas hypothétique)
- **Pourquoi maintenant** (urgence, blocage, opportunité)
- **Quelle approche** vous envisagez (1-2 paragraphes)
- **Si vous prévoyez de coder vous-même** la solution

Délai de réponse typique aux Discussions : 7-14 jours ouvrables, sans engagement.

## Style de code (si votre PR est acceptée en principe)

### Python (backends + modules partagés)

- **PEP 8** appliqué, longueur de ligne 100 caractères tolérée
- **Type hints** obligatoires pour les nouvelles fonctions publiques
- **Pydantic v2** pour les schémas de requête/réponse FastAPI
- Pas de `print()` en production — utiliser le `logger` du module

### TypeScript / React (frontends)

- **TypeScript strict** activé — pas de `any` implicite
- **React 18** — composants fonctionnels uniquement, pas de classes
- **Zustand** pour le state global
- **Tailwind CSS** pour le styling
- **ESLint** doit passer sans warning

### Commits

Style préféré (non strict) :
- `feat: …` — nouvelle fonctionnalité
- `fix: …` — correction de bug
- `docs: …` — documentation
- `refactor: …` — refactorisation sans changement de comportement
- `test: …` — tests
- `chore: …` — maintenance

Messages en **français** acceptés et préférés.

## Tests obligatoires avant PR

- **Backend** : `pytest` sans erreur
- **Frontend** : `npm run typecheck` et `npm run build` sans erreur
- **Sécurité** : aucun secret hardcodé (le CI Gitleaks bloquera sinon)

```bash
# À la racine
pytest

# Dans chaque frontend
cd ERP_REACT/frontend && npm run typecheck && npm run build
```

## Sécurité — checklist obligatoire

Avant de pousser :

```bash
git diff --staged   # Aucun secret dans le diff
git status          # Aucun fichier sensible (.env, *.key, credentials.json)
```

Toute PR contenant un secret en clair (clé API, mot de passe, token JWT, etc.) sera **rejetée immédiatement et l'historique git nettoyé**, indépendamment de la qualité du code.

## Revue et licence

- Délai de revue : **non garanti**. Une PR considérée mais non prioritaire peut rester ouverte plusieurs mois.
- Toute contribution acceptée est publiée sous [Apache 2.0](LICENSE)
- Les contributeurs significatifs sont ajoutés au [NOTICE](NOTICE)
- Le mainteneur (Constructo AI Inc.) se réserve le droit de fermer toute PR sans explication détaillée, particulièrement si elle ne respecte pas cette politique

## Vous voulez utiliser Constructo AI sans contribuer ?

**Le plus simple :** abonnez-vous au SaaS hébergé à [constructoai.ca](https://constructoai.ca) à partir de 79,99 $/mois. C'est la version officielle, maintenue, supportée et conforme.

**Vous voulez self-host malgré tout ?** C'est votre droit (Apache 2.0). Le code est complet. Mais **aucun support n'est fourni** — ni gratuit, ni payant. Les forks et déploiements externes sont votre responsabilité.

## Contact

- **Discussions GitHub** : questions générales, propositions, retours d'expérience
- **Sécurité** : voir [SECURITY.md](SECURITY.md), envoyer à info@constructoai.ca
- **Support commercial / SaaS / hébergement** : [constructoai.ca](https://constructoai.ca)

---

Merci de respecter cette politique. Elle permet à Constructo AI Inc. de continuer à offrir un produit fiable, supporté et abordable aux entrepreneurs québécois.
