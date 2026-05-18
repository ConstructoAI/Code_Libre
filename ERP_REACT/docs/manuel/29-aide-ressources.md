# Module 29 — Aide & Ressources

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `frontend/src/components/layout/Sidebar.tsx:208-245` (section "Aide & Ressources" du sidebar — liens externes)
> **Tables PostgreSQL** : aucune (section non backed par BD — uniquement des liens externes)
> **Cadrage** : la section "Aide & Ressources" est un bloc statique du sidebar gauche qui contient **3 liens externes** vers du contenu hors-application (chaine YouTube, repo GitHub Documents, page liens utiles). Ce n'est PAS un module fonctionnel — c'est un point d'entree vers la documentation et la formation.

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Les 3 ressources externes](#2-les-3-ressources-externes)
3. [Comportement du sidebar](#3-comportement-du-sidebar)
4. [Reference](#4-reference)
5. [FAQ](#5-faq)

---

## 1. Vue d ensemble

### 1.1 Mission de la section

Donner aux utilisateurs un acces rapide depuis le sidebar a 3 ressources externes :
- Tutoriels video (chaine YouTube officielle)
- Manuel utilisateur complet (ce repo Documents)
- Liens utiles (page de references curated)

### 1.2 Ce que cette section ne fait PAS

- Pas de contenu d aide **integre** dans l application
- Pas de **recherche** dans la documentation
- Pas de **bulles d aide contextuelles** (tooltips, popovers explicatifs sur les ecrans)
- Pas de **chat support** in-app (pour le support, voir email `info@constructoai.ca`)
- Pas de **suivi de lecture** ou de progression formation
- Pas de **bookmarks** personnels par utilisateur

### 1.3 Acces

- Sidebar (panneau de gauche, partie inferieure, sous tous les autres groupes de modules)
- Section visible : titre "Aide & Ressources" en majuscules grises (cf. `Sidebar.tsx:212`)
- Visible meme en mode collapsed du sidebar (icones seulement)
- Pas d URL interne — chaque clic ouvre un nouvel onglet vers le lien externe (`target="_blank"` + `rel="noopener noreferrer"`)

### 1.4 Permissions

Aucune. Section visible pour **tous les utilisateurs** authentifies (admin, super_admin, employe, super_user). Les liens cibles sont publics (YouTube, GitHub).

---

## 2. Les 3 ressources externes

Source : `Sidebar.tsx:215-219`.

| # | Ressource | Icone | URL cible | Type cible |
|---|-----------|-------|-----------|------------|
| 1 | **Vidéos** | Video | `https://www.youtube.com/channel/UC3EGXYQNj5UYGiyNfiiom_A` | Chaine YouTube ConstructoAI |
| 2 | **Manuel** | BookOpen | `https://github.com/ConstructoAI/Documents/blob/main/README.md` | Repo GitHub (cette documentation) |
| 3 | **Liens utiles** | ExternalLink | `https://github.com/ConstructoAI/Documents/blob/main/liens-utiles.md` | Page liens curated |

### 2.1 Vidéos (YouTube)

**URL** : `https://www.youtube.com/channel/UC3EGXYQNj5UYGiyNfiiom_A`

Chaine YouTube officielle de Constructo AI. Contient des tutoriels video sur :
- Premiers pas dans l ERP (onboarding)
- Tutoriels par module (creation projet, devis, BT, etc.)
- Cas d usage avances (ex: integration QuickBooks, cycle complet projet)
- Webinaires (mises a jour, releases majeures)

**Public cible** : utilisateurs visuels, formation initiale, depannage rapide.

**Frequence de mise a jour** : voir directement la chaine (pas de calendrier publie dans l app).

### 2.2 Manuel (Repo GitHub Documents)

**URL** : `https://github.com/ConstructoAI/Documents/blob/main/README.md`

Lien vers le **README.md du repo de documentation**. Le manuel utilisateur complet est organise par modules (29 modules au total — voir l index dans `ERP_REACT/docs/manuel/README.md` du repo prive).

**Public cible** : utilisateurs lecteurs, recherche par mot-cle (Ctrl+F dans GitHub), reference exhaustive.

> **Note** : le lien actuel pointe vers le repo `ConstructoAI/Documents` (public). Ce repo Documents miroir le contenu de `ERP_REACT/docs/manuel/` du repo principal `Code_Libre` (source de verite).

### 2.3 Liens utiles

**URL** : `https://github.com/ConstructoAI/Documents/blob/main/liens-utiles.md`

Page Markdown qui regroupe des liens externes utiles aux entrepreneurs en construction du Quebec. Contenu typique :
- **RBQ** (Regie du batiment du Quebec) : portail licences, normes, formulaires
- **CCQ** (Commission de la construction du Quebec) : declarations mensuelles, charges sociales, conventions collectives
- **CNESST** (Sante et securite) : prevention, indemnisation, declarations
- **Revenu Quebec** : TPS/TVQ, retenues a la source, formulaires
- **ARC** (Agence du revenu du Canada) : T4, T4A, declarations federales
- **Code de construction** (CNB modifie Quebec)
- **Programmes de subventions** (cf. manuel 21)

> **Note** : le contenu exact de cette page peut evoluer ; consulter la version live sur GitHub.

---

## 3. Comportement du sidebar

Source : `Sidebar.tsx:208-245`.

### 3.1 Affichage

- Bloc separe par une **ligne horizontale** (`border-t`) au-dessus du titre "Aide & Ressources"
- Titre **gris pale** en majuscules avec letter-spacing (`text-[#605e5c] uppercase tracking-wider`) — visible uniquement en mode normal/etendu (masque en mode collapsed)
- Chaque lien : icone + label + style identique aux autres items du sidebar (hover gris, padding standard)

### 3.2 Modes du sidebar

| Mode | Aide & Ressources |
|------|--------------------|
| **Normal** (sidebar etendu) | Titre + 3 items avec icone et label |
| **Collapsed** (sidebar reduit aux icones) | Titre masque, 3 icones avec tooltip hover |
| **Mobile** (hamburger drawer) | Plein affichage avec padding mobile (44px touch target) |

### 3.3 Comportement au clic

```tsx
<a
  href={link.href}
  target="_blank"
  rel="noopener noreferrer"
>
```

- **Nouvel onglet** systematique (`target="_blank"`)
- **Securite** : `rel="noopener noreferrer"` empeche la fenetre cible d acceder a `window.opener` (protection contre les attaques tabnabbing)
- **Pas de tracking** in-app du clic (aucun event analytics declenche cote ERP)

---

## 4. Reference

### 4.1 Composant frontend

- **Fichier** : `ERP_REACT/frontend/src/components/layout/Sidebar.tsx`
- **Lignes** : 208-245 (bloc "Aide & Ressources")
- **Imports utilises** : `Video`, `BookOpen`, `ExternalLink` (lucide-react icons)
- **Pas de state, pas de hook** — bloc purement statique

### 4.2 Configuration des liens

Les 3 URLs sont **hardcoded** dans le composant (lignes 215-219). Pour les modifier :
1. Editer `Sidebar.tsx`
2. Changer la valeur `href` du `link` correspondant
3. Optionnel : changer `label` ou `icon`
4. Rebuild frontend (`npm run build`)
5. Deployer

> **Pas d interface admin** pour configurer ces liens via UI. Modification = changement code + deploiement.

### 4.3 Endpoints backend

**Aucun**. La section ne fait aucun appel API au backend Constructo. Tous les clics ouvrent des onglets vers des URLs externes (YouTube, GitHub).

---

## 5. FAQ

**Q. Pourquoi les liens ouvrent-ils dans un nouvel onglet plutot que dans l app ?**
R. Pour preserver l etat de l application en cours (formulaire en cours de saisie, navigation, etc.). Le `target="_blank"` est volontaire.

**Q. Puis-je modifier ces 3 liens depuis l interface admin ?**
R. Non. Les liens sont hardcoded dans `Sidebar.tsx`. Pour changer, il faut modifier le code source et redeployer.

**Q. Y a-t-il une aide contextuelle dans chaque ecran (tooltips, popovers) ?**
R. Pas systematiquement. Certains ecrans ont des tooltips ad-hoc sur des champs specifiques, mais il n y a pas de systeme d aide contextuelle globale (pas de "?" universel par champ).

**Q. La chaine YouTube est-elle a jour ?**
R. Voir directement la chaine. La frequence de publication n est pas garantie cote ERP.

**Q. Le repo Documents est-il public ?**
R. Oui (`https://github.com/ConstructoAI/Documents` est un repo public). Toute personne avec le lien peut le lire (anonyme).

**Q. Ou rapporter une erreur dans la documentation ?**
R. Email `info@constructoai.ca` (cf. README.md ligne 126) ou ouvrir une issue GitHub sur le repo Documents.

**Q. Y a-t-il un chat support en direct dans l app ?**
R. Non. Pas de live chat. L assistant IA Claude (manuel 12) repond aux questions metier mais n est pas un canal support officiel pour les bugs / questions techniques.

**Q. La section "Aide & Ressources" sera-t-elle elargie a l avenir ?**
R. Hors scope de cette documentation. Toute evolution sera documentee dans une version future de ce manuel.

---

## 6. Recap one-pager

| Element | Detail |
|---------|--------|
| **Type de section** | Bloc statique du sidebar (3 liens externes) |
| **Code source** | `Sidebar.tsx:208-245` |
| **Backend** | Aucun (pas d API, pas de BD) |
| **Liens** | YouTube channel + GitHub README + GitHub liens-utiles.md |
| **Permissions** | Tous utilisateurs (aucun controle) |
| **Comportement** | Nouvel onglet (`target="_blank"` + `rel="noopener noreferrer"`) |
| **Configurable via UI** | Non (hardcoded) |
| **Modifications** | Edit `Sidebar.tsx` + rebuild + deploy |
| **Pas implemente** | Aide contextuelle in-app, recherche dans docs, chat support, bookmarks, tracking clics |

---

*Manuel 29 — Aide & Ressources — Constructo AI ERP — 2026-04-26*
