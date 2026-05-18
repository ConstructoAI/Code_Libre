# Manuel utilisateur — Module Factures

> **ERP Constructo** — Logiciel de gestion intégré pour entreprises de construction au Québec
> **Version du manuel** : 1.0
> **Date** : 2026-04-25
> **Public** : utilisateurs finaux (comptables, gestionnaires, administrateurs)

---

## Table des matières

1. [Vue d'ensemble et accès](#1-vue-densemble-et-acces)
2. [Interface — Liste et détail](#2-interface--liste-et-detail)
3. [Workflows pas-à-pas](#3-workflows-pas-a-pas)
4. [Référence — Champs, statuts, calculs](#4-reference--champs-statuts-calculs)
5. [Intégrations, cas particuliers et FAQ](#5-integrations-cas-particuliers-et-faq)

---

## 1. Vue d'ensemble et accès

### 1.1 À quoi sert le module Factures

Le module **Factures** centralise la facturation de votre entreprise de construction. Il permet de :

- **Créer des factures clients** numérotées automatiquement (`FACT-AAAA-NNNNN`)
- **Saisir des factures fournisseurs** (factures d'achat)
- **Calculer automatiquement** TPS (5 %), TVQ (9,975 %) et Total TTC
- **Enregistrer les paiements** (partiels ou complets) avec mode (chèque, virement, carte)
- **Générer des documents HTML professionnels** imprimables
- **Scanner une facture par IA** (extraction automatique depuis PDF/image)
- **Synchroniser** depuis devis acceptés ou bons de commande reçus
- **Exporter** vers QuickBooks (IIF), Sage 50 (CSV), tableurs
- **Gérer les retenues** (holdbacks contractuelles québécoises)

### 1.2 Concepts-clés

| Concept | Description |
|---|---|
| **Facture** | Numéro auto `FACT-AAAA-NNNNN` (ex: FACT-2026-00031) |
| **Type** | Vente (facture client) ou Achat (facture fournisseur) |
| **Lignes** | Description, quantité, unité, prix unitaire, montant, taxes |
| **Paiement** | Montant, mode (chèque/virement/carte/comptant), date |
| **Solde dû** | Total TTC − Total payé |
| **Retenue (holdback)** | Pourcentage retenu jusqu'à acceptation finale (typique 10 %) |
| **Période comptable** | Mois ou trimestre, peut être verrouillé |

### 1.3 Statuts

```
Brouillon → Envoyée → Partiellement payée → Payée
                   ↘
                     En retard / Annulée
```

### 1.4 Accès

- **Sidebar** → **Comptabilité** → onglet **Factures**
- **URL** : `/comptabilite` (sous-onglet Factures)

### 1.5 Permissions

- **Tous les utilisateurs authentifiés** peuvent CRUD
- **Périodes verrouillées** : modifications bloquées sur les factures dans une période fermée
- **Validation comptable** : certaines actions nécessitent un rôle administrateur (à venir)

---

## 2. Interface — Liste et détail

### 2.1 Page Comptabilité (`/comptabilite`) — onglet Factures

Layout :

```
+--------------------------------------------------------------+
| [+ Nouvelle facture] [Scan IA] [Recherche] [Statut v] [Type v] |
+--------------------------------------------------------------+
| Numéro      | Type   | Client/Fourn. | Date      | TTC      | Statut |
|-------------|--------|---------------|-----------|----------|--------|
| FACT-2026-1 | Vente  | ABC Construct.| 2026-04-15| 12 850$  | Payée  |
| FACT-2026-2 | Vente  | XYZ Ltée      | 2026-04-20| 28 450$  | Partielle |
| ACHAT-2026-1| Achat  | Béton Lévis   | 2026-04-22| 5 750$   | Brouillon |
+--------------------------------------------------------------+
| Pagination + Per-page                                         |
+--------------------------------------------------------------+
```

### 2.2 Cartes KPI (4)

| Carte | Description |
|---|---|
| Total factures | Nombre toutes catégories |
| À recouvrer | Σ soldes dus (factures Vente) |
| À payer | Σ soldes dus (factures Achat) |
| Encaissé ce mois | Σ paiements reçus mois courant |

### 2.3 Détail facture (panneau latéral)

#### Entête
- Numéro, Type (Vente/Achat), Statut (badge)
- Client/Fournisseur, Projet (si lié)
- Date émission, Date échéance, Conditions paiement

#### Sous-totaux
- Sous-total HT
- TPS (5 %)
- TVQ (9,975 %)
- **Total TTC**
- Total payé
- **Solde dû**

#### Lignes (tableau)
Description, Quantité, Unité, Prix unitaire, Montant. Édition inline. Bouton « + Ajouter ligne ».

#### Section Paiements
Liste des paiements reçus : Date, Montant, Mode, Référence. Bouton « + Enregistrer paiement ».

#### Section Retenues (holdbacks)
Si applicable : Pourcentage retenu, Montant, Date prévue de libération, Statut.

#### Boutons
- **Générer HTML** (document imprimable)
- **Envoyer par email** (au client)
- **Synchroniser** (depuis devis ou BC)
- **Modifier statut**
- **Supprimer** (soft-delete via statut Annulée)

### 2.4 Modale Création facture

| Section | Champs |
|---|---|
| Type | Vente / Achat (radio) |
| Client/Fournisseur | Dropdown CRM (filtré par type) |
| Projet | Dropdown (optionnel) |
| Devis lié | Dropdown (si Vente) |
| BC lié | Dropdown (si Achat) |
| Date émission | Date (défaut aujourd'hui) |
| Date échéance | Date |
| Conditions paiement | Texte (Net 30 par défaut) |
| Notes | Texte libre |

### 2.5 Modale Enregistrement paiement

| Champ | Détail |
|---|---|
| Montant * | $ CAD |
| Mode * | Chèque / Virement / Carte / Comptant / Autre |
| Référence | N° chèque, transaction, etc. |
| Date * | Défaut aujourd'hui |
| Notes | Texte libre |

### 2.6 Scan IA d'une facture

```
+-----------------------------------+
|  IMPORT FACTURE PAR IA            |
+-----------------------------------+
|  [📄 Drag & drop ou clic]         |
|  Formats : PDF, JPG, PNG          |
|                                   |
|  [Analyser]                       |
+-----------------------------------+
```

L'IA (Claude) extrait automatiquement :
- Numéro fournisseur
- Date émission
- Lignes (description, qté, prix)
- Sous-totaux, taxes
- Total TTC
- Conditions de paiement

L'utilisateur valide ensuite les données extraites avant création.

### 2.7 Vue mobile

Cards empilées avec menu **⋮** pour actions principales.

---

## 3. Workflows pas-à-pas

### 3.1 Créer une facture client (Vente)

1. `/comptabilite` → onglet Factures → bouton **« + Nouvelle facture »**
2. Choisir type **Vente**
3. Sélectionner le **Client** (Entreprise du CRM)
4. Sélectionner le **Projet** (optionnel)
5. Sélectionner le **Devis lié** (optionnel — pré-remplit les lignes)
6. Renseigner **Date émission** (défaut aujourd'hui)
7. **Date échéance** (calculée selon Conditions paiement)
8. **Conditions paiement** (Net 30 par défaut)
9. Notes
10. Cliquer **« Créer »**

> **À savoir** : numéro `FACT-AAAA-NNNNN` généré automatiquement.

### 3.2 Créer une facture fournisseur (Achat)

1. Bouton **« + Nouvelle facture »**
2. Choisir type **Achat**
3. Sélectionner le **Fournisseur**
4. Sélectionner le **BC lié** (optionnel — pré-remplit les lignes)
5. Renseigner les dates et conditions
6. Cliquer **« Créer »**

### 3.3 Scanner une facture par IA (extraction auto)

1. Bouton **« Scan IA »**
2. Glisser-déposer (ou cliquer) un PDF / JPG / PNG
3. Cliquer **« Analyser »**
4. L'IA extrait : numéro, date, lignes, totaux
5. Vérifier et corriger les données extraites
6. Cliquer **« Créer la facture »**

> **Important** : toujours valider les extractions IA avant création (l'IA peut se tromper sur des factures complexes).

### 3.4 Ajouter une ligne à une facture

1. Section Lignes → bouton **« + Ajouter ligne »**
2. Description, Quantité, Unité (heure, m², lot, etc.)
3. Prix unitaire
4. Le Montant est calculé (qté × prix)
5. Sauvegarde inline
6. Le **Total TTC** est recalculé automatiquement

### 3.5 Modifier ou supprimer une ligne

- Édition inline
- Icône poubelle pour supprimer
- Recalcul automatique des totaux

### 3.6 Enregistrer un paiement

1. Section Paiements → bouton **« + Enregistrer paiement »**
2. Saisir le **Montant** (peut être partiel)
3. Choisir le **Mode** (Chèque, Virement, Carte, Comptant, Autre)
4. **Référence** (n° chèque, transaction)
5. **Date** du paiement
6. Notes optionnelles
7. Cliquer **« Enregistrer »**

Le **solde dû** est automatiquement mis à jour. Le statut bascule à :
- **Partiellement payée** si solde > 0
- **Payée** si solde = 0

### 3.7 Annuler un paiement

Icône poubelle à côté du paiement → confirmer. Le solde dû est recalculé.

### 3.8 Synchroniser depuis un devis accepté

1. Devis en statut « Accepté »
2. Bouton **« Synchroniser »** sur le devis (ou sur la facture)
3. Création automatique d'une facture pré-remplie
4. Vérifier et ajuster avant envoi

### 3.9 Synchroniser depuis un BC reçu

1. BC en statut « Reçu » → bouton **« Créer facture »**
2. Création automatique d'une facture fournisseur (Achat)
3. Lignes pré-remplies depuis le BC
4. Vérifier et ajuster

### 3.10 Générer un document HTML imprimable

1. Sélectionner la facture → bouton **« Générer HTML »**
2. Document professionnel avec :
   - En-tête entreprise (logo, RBQ, NEQ, TPS, TVQ)
   - Infos facture (Numéro, Date, Échéance)
   - Infos client (Nom, Adresse)
   - Tableau lignes
   - Sous-totaux + Taxes + TOTAL TTC
   - Conditions de paiement
   - Notes / Remerciements
3. Imprimer ou enregistrer en PDF (Ctrl+P)

### 3.11 Envoyer une facture par email

1. Bouton **« Envoyer par email »**
2. Saisir l'adresse destinataire (pré-remplie avec email du client)
3. Personnaliser le message
4. Cliquer **« Envoyer »**
5. Statut bascule à « Envoyée »

### 3.12 Marquer une facture comme « En retard »

Statut automatique si Date échéance dépassée et solde > 0. Affichage en rouge dans la liste.

### 3.13 Annuler une facture

1. Statut → **« Annulée »**
2. La facture reste en base pour traçabilité
3. Le solde n'est plus comptabilisé dans les indicateurs

### 3.14 Gérer les retenues (holdbacks)

1. Section **Holdbacks** → bouton **« + Ajouter retenue »**
2. Pourcentage (typique 10 % au Québec)
3. Montant calculé automatiquement
4. Date prévue de libération
5. Statut : Retenue active → Libérée
6. À la libération : bouton **« Libérer »** → ajoute le montant au paiement

### 3.15 Filtrer la liste des factures

- Recherche libre (numéro, client, projet)
- Filtre Type (Vente / Achat)
- Filtre Statut (multi-sélection)
- Filtre Période (date émission)

### 3.16 Exporter vers QuickBooks

1. Bouton **« Exporter QuickBooks »**
2. Format **IIF** (Intuit Interchange Format)
3. Téléchargement du fichier
4. Importer dans QuickBooks

### 3.17 Exporter vers Sage 50

1. Bouton **« Exporter Sage 50 »**
2. Format CSV compatible Sage 50
3. Téléchargement
4. Importer dans Sage 50

### 3.18 Générer la déclaration de taxes (TPS/TVQ)

1. Onglet **Déclaration de taxes**
2. Sélectionner la période (mois / trimestre)
3. Le système calcule :
   - TPS perçue (sur ventes)
   - TPS payée (sur achats)
   - TPS à remettre = perçue − payée
   - Idem TVQ
4. Exporter en CSV pour Revenu Québec

### 3.19 Verrouiller une période comptable

Réservé aux administrateurs :
1. Onglet **Périodes** → sélectionner la période
2. Bouton **« Fermer la période »**
3. Confirmer
4. Toutes les factures de cette période deviennent en lecture seule

### 3.20 Synchronisation globale (sync-all)

1. Bouton **« Synchroniser tout »**
2. Le système crée automatiquement les écritures comptables manquantes pour :
   - Toutes les factures (clients et fournisseurs)
   - Tous les BC reçus
   - Toutes les heures pointées (charges salariales)
3. Synchronisation complète du grand livre

---

## 4. Référence — Champs, statuts, calculs

### 4.1 Champs Facture

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Numéro | Auto | Oui | FACT-AAAA-NNNNN ou ACHAT-AAAA-NNNNN |
| Type | Énum | Oui | Vente / Achat |
| Client/Fournisseur (FK) | FK | Oui | Référence companies.id |
| Projet | FK | Non | Référence projects.id |
| Devis lié (Vente) | FK | Non | Référence devis.id |
| BC lié (Achat) | FK | Non | Référence bons_commande.id |
| Date émission | Date | Oui | CURRENT_DATE par défaut |
| Date échéance | Date | Non | Calculée selon conditions |
| Conditions paiement | Texte | Non | Net 30 par défaut |
| Statut | Énum (6) | Oui | Voir 4.3 |
| Sous-total HT | Décimal | Auto | Σ montants lignes |
| TPS | Décimal | Auto | Sous-total × 5 % |
| TVQ | Décimal | Auto | Sous-total × 9,975 % |
| Total TTC | Décimal | Auto | Sous-total + TPS + TVQ |
| Total payé | Décimal | Auto | Σ paiements |
| Solde dû | Décimal | Auto | TTC − Payé |
| Notes | Texte | Non | Texte libre |
| Created_at, updated_at | Timestamp | Auto | Horodatage |

### 4.2 Champs Ligne

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Description | Texte | Oui | Désignation |
| Quantité | Décimal | Oui | Quantité |
| Unité | Texte | Non | heure, m², lot, etc. |
| Prix unitaire | Décimal | Oui | $ CAD HT |
| Montant | Décimal | Auto | qté × prix |

### 4.3 Statuts (6)

| Statut | Couleur | Description |
|---|---|---|
| Brouillon | Gris | En préparation |
| Envoyée | Bleu | Transmise au client |
| Partiellement payée | Ambre | Solde > 0 |
| Payée | Vert | Solde = 0 |
| En retard | Rouge | Échéance dépassée + solde > 0 |
| Annulée | Noir | Annulée volontairement |

### 4.4 Champs Paiement

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Montant | Décimal | Oui | $ CAD |
| Mode | Énum | Oui | Chèque / Virement / Carte / Comptant / Autre |
| Référence | Texte | Non | N° chèque, transaction |
| Date | Date | Oui | Date du paiement |
| Notes | Texte | Non | Texte libre |

### 4.5 Champs Retenue (Holdback)

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| Pourcentage | Décimal | Oui | Typique 10 % au Québec |
| Montant | Décimal | Auto | TTC × pourcentage |
| Date prévue libération | Date | Non | Date à laquelle libérer |
| Statut | Énum | Oui | Active / Libérée |

### 4.6 Calculs

#### Montant ligne
```
montant = quantité × prix_unitaire
```

#### Sous-total HT
```
sous_total_HT = SUM(montant_ligne) FROM facture_lignes WHERE facture_id = ?
```

#### Taxes
```
TPS = sous_total_HT × 5 %      (taxe fédérale)
TVQ = sous_total_HT × 9,975 %  (taxe provinciale Québec)
```

#### Total TTC
```
TTC = sous_total_HT + TPS + TVQ
```

#### Solde dû
```
solde_du = TTC - SUM(paiements.montant)
```

### 4.7 Calcul retenue

```
montant_retenue = TTC × pourcentage_retenue
montant_a_payer = TTC - montant_retenue
```

À la libération, le montant_retenue est facturé séparément.

### 4.8 Limites système

| Élément | Limite |
|---|---|
| Pagination | 20 par défaut, max 100 |
| Lignes par facture | Pas de limite stricte |
| Paiements par facture | Pas de limite |
| Périodes verrouillées | Modification bloquée sur factures dans la période |

### 4.9 Formats numériques

| Élément | Format | Exemple |
|---|---|---|
| Numéro Vente | FACT-AAAA-NNNNN | FACT-2026-00031 |
| Numéro Achat | ACHAT-AAAA-NNNNN | ACHAT-2026-00012 |
| Devise | $ CAD | 12 850,75 $ |
| Date | AAAA-MM-JJ | 2026-04-25 |
| Pourcentage | XX,XXX % | 9,975 % |

### 4.10 Modes de paiement (5)

Chèque, Virement bancaire, Carte de crédit, Comptant, Autre.

### 4.11 Conditions de paiement typiques

Net 15, Net 30 (défaut), Net 45, Net 60, Net 90, COD (Comptant à la livraison), 2/10 Net 30 (escompte 2 % si payé sous 10 jours), À la livraison.

### 4.12 Taxes québécoises (fixes)

| Taxe | Taux | Niveau |
|---|---|---|
| TPS | 5,000 % | Fédéral |
| TVQ | 9,975 % | Provincial |
| **Combiné** | **14,975 %** | Sur sous-total HT |

### 4.13 Retenues (holdbacks) typiques au Québec

- **Construction commerciale** : 10 % du contrat retenu jusqu'à acceptation finale
- **Construction résidentielle** : variable selon contrat
- **Libération** : après acceptation finale du chantier (généralement 30-60 jours après fin)

### 4.14 Formats d'export comptable

| Format | Cible | Extension |
|---|---|---|
| QuickBooks | QuickBooks Desktop | .iif |
| Sage 50 | Sage 50 (anciennement Simply Comptable) | .csv |
| CSV générique | Excel / autres tableurs | .csv |

---

## 5. Intégrations, cas particuliers et FAQ

### 5.1 Intégrations avec les autres modules

| Module | Relation | Manifestation |
|---|---|---|
| **CRM (Companies)** | Client/Fournisseur sur la facture | Sélection à la création |
| **Devis** | Devis accepté → Facture pré-remplie | Bouton « Synchroniser » |
| **Bons de Commande** | BC reçu → Facture fournisseur pré-remplie | Bouton « Créer facture » |
| **Projets** | Facture liée à un projet | Apparaît dans les revenus du projet |
| **Comptabilité (Grand Livre)** | Écriture comptable auto | Sync-all génère les entrées de journal |
| **IA (Claude)** | Scan facture (extraction PDF/image) | Bouton « Scan IA » |
| **Cost Centers** | Affectation analytique | Suivi par centre de coût |
| **Fixed Assets** | Facture d'achat d'immobilisation | Création asset auto si > seuil |

### 5.2 Cas particuliers

- **Facture sans client/fournisseur** : impossible. Le client/fournisseur est obligatoire
- **Facture sans projet** : permis (facture générale, frais admin, etc.)
- **Paiement supérieur au solde** : le surplus crée un crédit client (à reporter sur prochaine facture)
- **Modification après envoi** : possible mais à éviter (le client a une version différente)
- **Annulation après paiement** : créer une note de crédit à la place
- **Période fermée** : factures dans la période ne sont plus modifiables
- **Facture multi-devises** : non supportée, uniquement CAD
- **Acompte / Avance** : créer une facture d'acompte (X % du total) puis facture finale (solde)

### 5.3 Astuces

- **Synchronisation devis → facture** : éviter de saisir manuellement, gain de temps important
- **Scan IA** : utile pour traiter les factures fournisseurs en lot (gagne 80 % du temps)
- **Conditions de paiement** : standardiser pour éviter les ambiguïtés
- **Date échéance** : calculée automatiquement selon les conditions
- **Encaissements** : enregistrer immédiatement pour suivre la trésorerie
- **Holdbacks** : ne pas oublier de libérer à la fin du chantier
- **Export QuickBooks/Sage** : faire mensuellement pour synchroniser avec la comptabilité externe
- **Déclaration de taxes** : générer trimestriellement pour Revenu Québec

### 5.4 FAQ

**Q : Le numéro de facture est-il unique ?**
R : Oui, unique au niveau du tenant. Format FACT-AAAA-NNNNN (Vente) ou ACHAT-AAAA-NNNNN (Achat).

**Q : Puis-je créer plusieurs factures pour un même devis (acomptes) ?**
R : Oui. Le devis n'est pas verrouillé après la première facture. Saisir manuellement les montants d'acompte.

**Q : Comment annuler une facture déjà payée ?**
R : Créer une **note de crédit** (facture négative) du même montant. Ne pas supprimer la facture originale (intégrité comptable).

**Q : L'IA scan supporte-t-elle les factures manuscrites ?**
R : Partiellement. Mieux pour les factures imprimées/numérisées. Toujours valider les extractions.

**Q : Puis-je modifier une facture dans une période fermée ?**
R : Non, sauf si l'administrateur rouvre la période (rare, traçabilité altérée).

**Q : Comment gérer une retenue à la garantie (holdback) ?**
R : Section Holdbacks → ajouter un holdback de 10 % (typique Québec). À la libération, créer une nouvelle facture pour le montant retenu.

**Q : La TPS/TVQ peut-elle être désactivée pour des clients exonérés ?**
R : Pas de fonction native. Saisir manuellement les taxes à 0 sur la facture (à vérifier conformité).

**Q : Puis-je avoir des factures en USD ?**
R : Non, uniquement CAD dans cette version.

**Q : Comment relancer un client en retard ?**
R : Pas de relance automatique. Utiliser le module Emails pour envoyer un rappel manuel.

**Q : Le système calcule-t-il les intérêts de retard ?**
R : Non automatiquement. Calculer manuellement et créer une nouvelle facture pour les intérêts.

**Q : Comment exporter pour mon comptable externe ?**
R : Format QuickBooks (.iif) ou Sage 50 (.csv). Disponibles dans l'onglet Export.

**Q : Puis-je voir l'historique des modifications d'une facture ?**
R : Pas de journal d'audit visible côté UI dans cette version.

### 5.5 Limites connues

- Pas de relances automatiques (workaround : module Emails)
- Pas de calcul automatique des intérêts de retard
- Pas de devises multiples (CAD uniquement)
- Pas de signature électronique sur les factures (côté client)
- Pas de paiement en ligne intégré (Stripe/Paypal)
- Pas d'envoi automatique récurrent (factures mensuelles, abonnements)
- Pas de gestion des avoirs / notes de crédit en tant qu'objet distinct
- Pas d'historique des modifications visible côté UI
- Périodes fermées : seul l'administrateur peut rouvrir (action sensible)

---

> **Besoin d'aide supplémentaire ?** Contactez votre administrateur ou l'équipe support de Constructo.

---

*Manuel généré pour ERP Constructo — Module Factures — v1.0 — 2026-04-25*
