# Module 7 — Factures / Comptabilite

> **Version** : 2.0 (refonte verifiee contre code source)
> **Code de reference** : `backend/routers/accounting.py` (4426 lignes), `frontend/src/pages/ComptabilitePage.tsx` (2516 lignes)
> **Tables PostgreSQL** : `factures`, `factures_lignes`, `journal_entries`, `journal_lignes`, `comptes_comptables`, `centres_couts`, `periodes_comptables`, `retenues_chantier`

---

## Sommaire

1. [Vue d ensemble](#1-vue-d-ensemble)
2. [Interface (Comptabilite)](#2-interface-comptabilite)
3. [Workflows pas-a-pas](#3-workflows-pas-a-pas)
4. [Reference](#4-reference)
5. [Integrations & FAQ](#5-integrations-faq)
6. [Recap one-pager](#6-recap-one-pager)

---

## 1. Vue d ensemble

### 1.1 Mission du module

Centraliser la **comptabilite** d une entreprise de construction quebecoise :
- Emettre des **factures clients** (Vente) et saisir des **factures fournisseurs** (Achat)
- Calculer **TPS 5% / TVQ 9.975%** automatiquement et stocker en base
- Enregistrer les **paiements** (partiels / complets) avec creation automatique d ecritures journal
- Tenir le **grand livre** en partie double avec plan comptable Quebec construction (28 comptes pre-charges)
- Generer **bilans, etats des resultats, flux de tresorerie, balance de verification**
- Gerer **retenues de garantie** (holdbacks 10% par defaut) avec cycle Retenue -> Liberation
- Gerer **periodes comptables** (ouvertes/cloturees)
- **Scanner une facture papier par IA** (Claude vision + PDF) et auto-remplir les champs
- **Synchroniser** retroactivement journal depuis factures + paiements + BC + heures (idempotent)
- **Exporter** QuickBooks IIF, Sage 50 CSV, declaration TPS/TVQ, plan comptable, balance, journal

### 1.2 Format numero facture

**`FACT-YYYY-NNNNN`** (ex. `FACT-2026-00031`).

Source : `accounting.py:783` `numero_facture = f"FACT-{year_str}-{facture_id:05d}"`.

- `YYYY` = annee courante (`datetime.now().year`)
- `NNNNN` = id facture zero-padded sur 5
- Genere atomiquement (TEMP-then-UPDATE pattern, race-safe)

### 1.3 6 statuts facture

Source : `ComptabilitePage.tsx:51-55` (`INVOICE_STATUT_COLORS`)

| Statut                | Couleur badge | Auto-mise-a-jour ?                            |
|-----------------------|---------------|-----------------------------------------------|
| `BROUILLON`           | gris          | Defaut a la creation                          |
| `ENVOYEE`             | indigo        | Manuel (changement statut)                    |
| `PAYEE`               | vert          | **AUTO** quand `solde <= 0.01` apres paiement |
| `PARTIELLEMENT_PAYEE` | jaune         | **AUTO** quand `montant_paye > 0` mais < TTC  |
| `EN_RETARD`           | rouge         | Manuel (pas de cron auto sur date_echeance)   |
| `ANNULEE`             | gris          | Soft-delete (mise a jour statut)              |

> **Note** : `PARTIELLE` existe dans `INVOICE_STATUT_COLORS` mais **n est jamais defini par le code**. Residu mort cote UI. Utiliser `PARTIELLEMENT_PAYEE`.

### 1.4 Type de destinataire vs type de journal

Deux concepts distincts :

| Concept            | Champ                | Valeurs                                                                                                          |
|--------------------|----------------------|------------------------------------------------------------------------------------------------------------------|
| Type destinataire  | `type_destinataire`  | `client` (vente) ou `fournisseur` (achat) — `lowercase`                                                          |
| Type journal       | `type_journal`       | `VENTE`, `ACHAT`, `SALAIRE`, `AJUSTEMENT`, `AUTRE` — `UPPERCASE` (cf. JOURNAL_TYPE_OPTIONS ComptabilitePage.tsx:69) |

### 1.5 5 Modes de paiement

`Virement`, `Cheque`, `Carte de credit`, `Comptant`, `Autre` (Title Case avec espaces, cf. ComptabilitePage.tsx:2384).

> **Champ texte libre** cote backend (`mode_paiement: Optional[str]`) — l UI propose la liste fixe mais le backend accepte n importe quelle chaine.

### 1.6 Acces

- Sidebar -> **Comptabilite** (icone Calculator)
- URL : `/comptabilite`
- Onglet par defaut : **Factures** (`?tab=factures`)
- Auto-ouverture facture : `/comptabilite?tab=factures&open={facture_id}`

### 1.7 Permissions

- Tous les utilisateurs authentifies du tenant peuvent CRUD factures, journal, paiements, periodes.
- **Aucun verrou DB** sur les periodes cloturees (le statut `CLOTUREE` est purement informatif — pas de constraint qui bloque les inserts/updates dans la periode).
- **Aucun role « comptable »** — pas de matrice de permissions granulaires sur ce module.
- **Soft-delete factures** via `statut = 'ANNULEE'` (pas de DELETE physique).

---

## 2. Interface (Comptabilite)

### 2.1 Page `/comptabilite`

**11 onglets** dans `ComptabilitePage.tsx:37` :

| Cle                  | Label                  | Contenu                                                       |
|----------------------|------------------------|---------------------------------------------------------------|
| `factures`           | Factures               | Liste factures + vue Detail + paiements (DEFAUT)              |
| `journal`            | Journal                | Ecritures journal en partie double                            |
| `transactions`       | Transactions           | Vue agregee Revenus / Depenses                                |
| `dashboard_financier`| Dashboard financier    | KPIs financiers + graphiques (CA, encaisse, solde du)         |
| `plan_comptable`     | Plan comptable         | Liste 28 comptes (auto-seed)                                  |
| `grand_livre`        | Grand livre            | Vue par compte avec mouvements debit/credit                   |
| `etats_financiers`   | Etats financiers       | Bilan, Resultats, Flux de tresorerie, Declaration TPS/TVQ     |
| `centres_couts`      | Centres de couts       | Centres de cout + budgets                                     |
| `periodes`           | Periodes               | Periodes comptables (creation + cloture)                      |
| `retenues`           | Retenues               | Retenues de garantie (creation + liberation)                  |
| `immobilisations`    | Immobilisations        | Immobilisations + amortissements (UI partielle)               |

### 2.2 Onglet « Factures »

#### 2.2.1 Tableau factures (gauche)

Colonnes :
- **Numero** (`FACT-YYYY-NNNNN`)
- **Type** (Vente / Achat)
- **Client / Fournisseur** (texte denormalise)
- **Date facture**
- **Date echeance**
- **Montant TTC**
- **Solde du**
- **Statut** (badge couleur)

Actions globales :
- **+ Nouvelle facture** (modale creation — type Vente ou Achat)
- **Scan IA** (upload image/PDF -> extraction Claude vision)
- Recherche texte (numero, client/fournisseur)
- Filtre par statut (dropdown 6 valeurs)
- Filtre par type (Vente / Achat)
- Filtre par periode (dropdown periodes_comptables)
- Pagination (20/page, jusqu a 100)

#### 2.2.2 Vue Detail facture (droite)

**Encart en-tete** :
- Numero + badge statut
- Type, client/fournisseur, date facture, date echeance
- Montant HT, TPS, TVQ, **TTC**, Paye, **Solde du**
- Notes
- Periode comptable associee

**Boutons d action** :
- **Generer HTML** (icone Printer) -> aperçu plein ecran
- **Modifier** (icone Edit) -> modale edition (date, client, statut, notes)
- **+ Paiement** (icone DollarSign) -> modale enregistrement paiement
- **Supprimer** -> soft-delete (`statut = 'ANNULEE'`)

**Section Lignes** :
- Tableau : description, code produit (si lie), quantite, unite, prix unitaire, montant
- Bouton **+ Ajouter ligne** (formulaire inline)
- Edition inline (clic cellule)
- Bouton suppression (icone poubelle)
- Recalcul auto `montant_total = SUM(lignes.montant)` + TPS/TVQ a chaque modification

**Section Paiements** :
- Historique des paiements (date, montant, mode, reference)
- Pas de bouton « Annuler paiement » (irreversible une fois enregistre)

### 2.3 Onglet « Journal »

Tableau journal en partie double :
- **Numero ecriture** (auto)
- **Date**
- **Type** (VENTE / ACHAT / ENCAISSEMENT / DECAISSEMENT / RETENUE / LIBERATION_RETENUE / SALAIRE / AJUSTEMENT / AUTRE)
- **Description**
- **Reference** (numero document source)
- **Total debit** / **Total credit** (toujours egaux par definition)
- **Statut** (BROUILLON / VALIDEE)

Actions :
- **+ Nouvelle ecriture** (manuelle)
- **Valider** (PUT /journal/{id}/validate) — passe BROUILLON -> VALIDEE, fige les lignes
- Filtre par type, periode, statut
- Vue Detail : tableau lignes (compte, libelle, debit, credit)

### 2.4 Onglet « Transactions »

Vue agregee :
- **Revenus** : SUM(montant_ttc) WHERE type_destinataire='client' GROUP BY mois
- **Depenses** : SUM(montant_ttc) WHERE type_destinataire='fournisseur' GROUP BY mois + depenses BC + heures employes
- Graphique barres mensuel
- Solde net = Revenus - Depenses

### 2.5 Onglet « Dashboard financier »

KPIs (cf. `GET /accounting/summary`) :
- Total factures (count + somme TTC)
- Factures payees (count + %)
- Factures en retard (count + somme solde)
- CA total (revenus encaisses)
- Total encaisse (paiements recus)
- Total solde du (comptes clients)
- Total ecritures journal
- Ecritures en brouillon (a valider)
- Total comptes (plan comptable actif)

Graphiques :
- Evolution CA mensuelle
- Repartition revenus par type compte
- Top 10 clients par CA
- Aged receivables (0-30j / 31-60j / 61-90j / 90+j)

### 2.6 Onglet « Plan comptable »

Tableau des **comptes comptables** :
- **Code** (ex. `1010`, `4100`)
- **Nom** (ex. `Encaisse generale`)
- **Type** (ACTIF / PASSIF / CAPITAUX / REVENU / CHARGE)
- **Classe** (1-6, standard quebecois)
- **Solde normal** (DEBIT / CREDIT)
- **Actif** (boolean)
- **Solde courant** (calcul a la volee depuis journal_lignes validees)

Auto-seed au premier appel `GET /chart-of-accounts` (28 comptes pre-charges — cf. section 4.5).

### 2.7 Onglet « Grand livre »

Selection compte (dropdown) -> tableau :
- Date, ecriture #, description, reference
- **Debit** / **Credit** / **Solde courant** (cumule)
- Filtre par periode

Endpoints : `GET /ledger?account_id=X` ou `GET /ledger/accounts` (vue globale).

### 2.8 Onglet « Etats financiers »

Sous-onglets :

| Sous-onglet            | Endpoint                      | Calcul                                                        |
|------------------------|-------------------------------|---------------------------------------------------------------|
| **Bilan**              | `GET /balance-sheet`          | Actif vs Passif vs Capitaux (par classe 1, 2, 3)              |
| **Etat des resultats** | `GET /income-statement`       | Revenus (classe 4) - Charges (classes 5+6) = Resultat net     |
| **Flux de tresorerie** | `GET /cash-flow`              | Encaisse mensuelle (paiements - depenses)                     |
| **Balance verification**| `GET /trial-balance`         | SUM(debit) = SUM(credit) par compte (validation comptable)    |
| **Declaration TPS/TVQ**| `GET /export/tax-declaration/csv` | TPS recue - TPS payee, TVQ recue - TVQ payee (par periode) |

Bouton **Exporter CSV** sur chaque sous-onglet.

### 2.9 Onglet « Centres de couts »

Tableau centres de couts :
- Code (ex. `PRJ-00007` auto-genere depuis project_id)
- Nom, Type, Description
- Budget annuel
- Solde courant (depenses imputees)
- Actif (boolean)

Endpoint summary : `GET /cost-centers/summary` -> agregation par centre.

### 2.10 Onglet « Periodes »

Tableau periodes comptables :
- Nom (ex. `Janvier 2026`, `T1 2026`)
- Annee fiscale, Periode #, Date debut, Date fin
- Statut : `OUVERTE` (badge vert) / `CLOTUREE` (badge gris)
- Cloture par (utilisateur), Date cloture

Actions :
- **+ Nouvelle periode**
- **Cloturer** (PUT /periods/{id}/close) — bascule statut

> **CLOTUREE est purement informatif** : aucune contrainte DB ne bloque les modifications dans une periode cloturee (cf. section 5.3 FAQ).

### 2.11 Onglet « Retenues »

Tableau retenues de garantie :
- Facture liee
- Montant retenu, Taux retenue (defaut 10%)
- Date fin travaux, Date liberation
- Statut : `RETENUE` / `LIBEREE`
- Notes

Actions :
- **+ Nouvelle retenue** (depuis une facture)
- **Liberer** (PUT /holdbacks/{id}/release) -> cree ecriture journal LIBERATION_RETENUE
- Filtre par statut
- Vue « A liberer prochainement » (`GET /holdbacks/upcoming`)

### 2.12 Onglet « Immobilisations »

Implementation **partielle** (UI affichee, endpoints minimaux). Permet la saisie d immobilisations mais l amortissement automatique n est pas integre dans le journal.

---

## 3. Workflows pas-a-pas

### 3.1 Creer une facture client (Vente)

1. Comptabilite -> onglet **Factures** -> bouton **+ Nouvelle facture**.
2. Modale creation :
   - **Type destinataire** : `client` (radio)
   - **Client** (dropdown companies — filtre type=client)
   - **Date facture** (defaut aujourd hui)
   - **Date echeance** (defaut +30 jours)
   - **Devis associe** (optionnel — dropdown devis acceptes du meme client)
   - **Notes** (texte libre)
3. **Enregistrer** -> `POST /accounting/invoices`.
4. Backend :
   - INSERT avec `numero_facture = TEMP`, `statut = BROUILLON`, `type_destinataire = client`.
   - UPDATE `numero_facture = FACT-YYYY-NNNNN` (pattern lpad(id, 5)).
   - Si `devis_id` : auto-link vers dossier CRM (table `dossier_factures`, ON CONFLICT DO NOTHING).
5. La facture apparait avec statut `BROUILLON`, montant 0$.

### 3.2 Saisir une facture fournisseur (Achat)

1. Meme bouton **+ Nouvelle facture**, mais cocher **Type destinataire = `fournisseur`**.
2. Champ **Fournisseur** (dropdown fournisseurs).
3. Champ **Numero externe** (numero du fournisseur, optionnel).
4. **BC associe** (optionnel — dropdown BC du meme fournisseur).
5. **Enregistrer** -> meme endpoint, mais `type_destinataire = fournisseur`.

### 3.3 Ajouter une ligne facture

1. Vue Detail facture -> section **Lignes** -> bouton **+ Ajouter ligne**.
2. Formulaire ligne :
   - **Produit** (dropdown inventaire — auto-rempli) ou **Description** libre
   - **Quantite** (numeric, > 0)
   - **Unite** (texte)
   - **Prix unitaire** (numeric, >= 0)
3. **Enregistrer** -> `POST /accounting/invoices/{id}/lines`.
4. Backend :
   - Calcule `montant = round(quantite * prix_unitaire, 2)`.
   - INSERT dans `factures_lignes`.
   - Recalcule **totaux facture** (`_recalculate_invoice`) :
     - `total_ht = SUM(lignes.montant)`
     - `tps = round(total_ht * 0.05, 2)`
     - `tvq = round(total_ht * 0.09975, 2)`
     - `montant_ttc = total_ht + tps + tvq`
     - `solde_du = montant_ttc - montant_paye`
   - UPDATE table `factures` avec ces valeurs.

### 3.4 Modifier ou supprimer une ligne

**Modifier** :
1. Cellule cliquable inline (description, quantite, unite, prix unitaire).
2. Modifier -> blur ou Enter -> `PUT /accounting/invoices/{id}/lines/{line_id}`.
3. Recalcul auto totaux.

**Supprimer** :
1. Icone poubelle a droite -> confirmation -> `DELETE /accounting/invoices/{id}/lines/{line_id}`.
2. Recalcul auto totaux.

### 3.5 Enregistrer un paiement

1. Vue Detail facture -> bouton **+ Paiement** (icone DollarSign).
2. Modale :
   - **Montant** (obligatoire, > 0 — peut etre partiel)
   - **Date paiement** (defaut aujourd hui)
   - **Mode paiement** (dropdown : Virement / Cheque / Carte de credit / Comptant / Autre)
   - **Reference** (texte libre — numero cheque, ID transaction, etc.)
3. **Enregistrer** -> `POST /accounting/invoices/{id}/payment`.
4. Backend :
   - `new_paye = round(montant_paye_actuel + body.montant, 2)`
   - `new_solde = round(montant_total - new_paye, 2)`
   - Si `new_solde <= 0.01` : statut -> `PAYEE`, solde -> `0.0`
   - Sinon si `new_paye > 0` : statut -> `PARTIELLEMENT_PAYEE`
   - UPDATE `factures` : `montant_paye`, `solde_du`, `statut`, `date_paiement` (derniere date), `mode_paiement` (derniere valeur), `reference_paiement`.
   - **Auto-cree ecriture journal** :
     - Type : `ENCAISSEMENT`
     - Debit : compte `1010` (Encaisse generale) - montant
     - Credit : compte `1100` (Comptes clients) - montant
     - Auto-validee a la creation
     - Reference : numero facture
     - **Non bloquant** : si la creation de l ecriture echoue, le paiement est tout de meme enregistre (log warning).

> **Pas de table `paiements` dediee** : l historique est stocke comme champs cumulatifs sur `factures` (`montant_paye`, `solde_du`, `date_paiement`). Pas de detail multi-paiements en base — seul le dernier mode/reference est conserve.

### 3.6 Annuler une facture (soft-delete)

1. Vue Detail facture -> bouton **Supprimer** (icone Trash2).
2. Confirmation -> `PUT /accounting/invoices/{id}` avec `{statut: ANNULEE}`.
3. La facture passe en `ANNULEE` (badge gris). **Reste en base** et reste consultable via filtre statut.
4. Aucun rollback de paiement enregistre. Aucun rollback d ecriture journal generee.

> Pour reverser une facture deja payee : creer une ecriture journal manuelle de type AJUSTEMENT (Debit comptes clients / Credit encaisse).

### 3.7 Scanner une facture par IA

1. Onglet Factures -> bouton **Scan IA**.
2. Modale upload : selectionner image (JPG/PNG) ou PDF (max 20 MB).
3. **Analyser** -> `POST /accounting/invoices/ai/scan` (multipart/form-data).
4. Backend :
   - Encode le fichier en base64.
   - Appelle `claude-sonnet-4-6` avec vision + document API.
   - Prompt systeme : Expert en comptabilite construction au Quebec.
   - Liste des fournisseurs connus injectee dans le prompt pour matching.
   - Parse le JSON retourne (extraction strict).
5. Reponse JSON :
   - `fournisseur_nom`, `fournisseur_id` (si match)
   - `numero_facture`, `date_facture`, `date_echeance`
   - `montant_ht`, `tps`, `tvq`, `montant_ttc`
   - `lignes[]` (array description/quantite/prix)
   - `confiance` (`haute` / `moyenne` / `basse`)
6. Modale pre-remplie avec les valeurs extraites -> utilisateur valide / corrige -> Enregistrer (cf. section 3.2).
7. **Cout** : deduit des credits IA prepayes du tenant (`(tokens_in * 0.003 + tokens_out * 0.015) / 1000 * 1.30`). Tracking dans `ai_usage`.

> **Multi-pages** : pour PDF multi-pages, le prompt instruit l IA d analyser toutes les pages et de consolider les lignes.

### 3.8 Generer le HTML/PDF facture

1. Vue Detail facture -> bouton **Generer HTML** (icone Printer).
2. `POST /accounting/invoices/{id}/generate-html` -> renvoie `{html: ...}`.
3. Le HTML s ouvre dans un nouvel onglet ou modale aperçu.
4. Inclut :
   - En-tete entreprise (logo, RBQ, NEQ, TPS, TVQ depuis `parametres_entreprise`)
   - Bloc client/fournisseur (denormalise depuis facture)
   - Tableau lignes (description, qte, unite, prix, montant)
   - Sommaire : Sous-total HT, TPS 5%, TVQ 9.975%, **TOTAL TTC**
   - Si paiements : Total paye, **Solde du**
   - Numero facture, date facture, date echeance
   - Notes
   - Conditions de paiement (texte fixe)
   - Theme couleurs depuis `parametres_documents`
5. Bouton **Imprimer** (Ctrl+P) -> Imprimante ou Enregistrer en PDF.

### 3.9 Creer une ecriture journal manuelle

1. Onglet **Journal** -> bouton **+ Nouvelle ecriture**.
2. Formulaire :
   - **Date**
   - **Type** (VENTE / ACHAT / SALAIRE / AJUSTEMENT / AUTRE)
   - **Description**
   - **Reference** (optionnel)
3. **Enregistrer** -> `POST /accounting/journal` (statut `BROUILLON`).
4. Vue Detail ecriture -> ajouter lignes :
   - **Compte** (dropdown plan comptable)
   - **Libelle**
   - **Debit** OU **Credit** (l un des deux > 0)
5. **+ Ajouter ligne** -> `POST /accounting/journal/{id}/lines`.
6. Quand SUM(debit) = SUM(credit) -> bouton **Valider** disponible -> `PUT /accounting/journal/{id}/validate` -> statut `VALIDEE`.

> Une ecriture VALIDEE est figee (lignes non modifiables). Pour corriger, creer une ecriture inverse de type AJUSTEMENT.

### 3.10 Cloturer une periode comptable

1. Onglet **Periodes** -> selectionner une periode `OUVERTE` -> bouton **Cloturer**.
2. Confirmation -> `PUT /accounting/periods/{id}/close`.
3. UPDATE `periodes_comptables` : `statut = CLOTUREE`, `cloture_par`, `cloture_at`.
4. **Aucune contrainte DB** ne bloque les inserts/updates dans la periode (cf. section 5.3 FAQ).
5. Bonne pratique : ne pas modifier les ecritures dans une periode cloturee — la cloture sert de marqueur informatif pour les rapports.

### 3.11 Synchroniser le journal (rattrapage)

Pour generer retroactivement les ecritures journal manquantes :

1. Endpoint admin : `POST /accounting/sync-all`.
2. Execute en cascade :
   - `sync-factures` : cree ecritures VENTE pour factures sans `journal_entry_id`
   - `sync-paiements` : cree ecritures ENCAISSEMENT pour paiements non syncs
   - `sync-depenses` : cree ecritures ACHAT pour BC `Recu`/`Facture` sans entry + heures employes
3. **Idempotent** : utilise `WHERE journal_entry_id IS NULL` ou `NOT EXISTS` pour eviter les doublons.
4. Retourne un rapport : `{factures_synced: 12, paiements_synced: 8, depenses_synced: 3}`.

> Utile apres un import de donnees historiques ou apres restauration de backup.

### 3.12 Creer une retenue de garantie (holdback)

1. Onglet **Retenues** -> bouton **+ Nouvelle retenue** -> selectionner facture.
2. Champs :
   - **Taux retenue** (defaut **10%**)
   - **Montant retenu** (auto-calcule = `ttc * taux/100`, modifiable)
   - **Date fin travaux** (date prevue d acceptation finale)
   - **Notes**
3. **Enregistrer** -> `POST /accounting/holdbacks`.
4. Backend :
   - INSERT dans `retenues_chantier` avec `statut = RETENUE`.
   - **Auto-cree ecriture journal** type `RETENUE` :
     - Debit : compte `1150` (Retenues a recevoir) - montant
     - Credit : compte `1100` (Comptes clients) - montant
   - Lien `journal_entry_retenue_id` stocke.

### 3.13 Liberer une retenue

1. Onglet Retenues -> selectionner une retenue `RETENUE` -> bouton **Liberer**.
2. Confirmation + saisie date liberation -> `PUT /accounting/holdbacks/{id}/release`.
3. Backend :
   - UPDATE `retenues_chantier` : `statut = LIBEREE`, `date_liberation`.
   - **Auto-cree ecriture journal** type `LIBERATION_RETENUE` :
     - Debit : compte `1010` (Encaisse generale) - montant
     - Credit : compte `1150` (Retenues a recevoir) - montant
   - Lien `journal_entry_liberation_id` stocke.

### 3.14 Exporter les donnees comptables

Tous les exports sont des fichiers telecharges via le navigateur (Content-Disposition: attachment).

| Action                              | Endpoint                              | Format    |
|-------------------------------------|---------------------------------------|-----------|
| Exporter le journal (validees)      | `GET /export/journal/csv`             | CSV       |
| Exporter le plan comptable          | `GET /export/chart-of-accounts/csv`   | CSV       |
| Exporter le grand livre             | `GET /export/ledger/csv`              | CSV       |
| Exporter la balance de verification | `GET /export/trial-balance/csv`       | CSV       |
| Exporter la declaration TPS/TVQ     | `GET /export/tax-declaration/csv`     | CSV       |
| Exporter vers QuickBooks            | `GET /export/quickbooks/iif`          | **IIF natif** |
| Exporter vers Sage 50               | `GET /export/sage50/csv`              | CSV       |

Boutons **Exporter** disponibles dans chaque onglet correspondant.

> **Format IIF QuickBooks** : structure native Intuit avec blocks `!TRNS` / `!SPL` / `!ENDTRNS`, mappage VENTE -> INVOICE, ENCAISSEMENT -> PAYMENT, etc. Compatible import direct dans QuickBooks Desktop.

---

## 4. Reference

### 4.1 Statuts factures

Source : `accounting.py:2729-2735` (auto-set logic) + `ComptabilitePage.tsx:51-55` (color map).

| Statut                | Set par                                      | Action manuelle possible ? |
|-----------------------|----------------------------------------------|---------------------------|
| `BROUILLON`           | Auto a la creation                           | OUI (PUT /invoices/{id})  |
| `ENVOYEE`             | Manuel uniquement                            | OUI                       |
| `PAYEE`               | **AUTO** quand `solde <= 0.01` apres paiement | OUI (mais decoherence avec montant_paye possible) |
| `PARTIELLEMENT_PAYEE` | **AUTO** quand `montant_paye > 0`            | OUI                       |
| `EN_RETARD`           | Manuel uniquement (pas de cron auto)         | OUI                       |
| `ANNULEE`             | Soft-delete via PUT statut                   | OUI                       |
| `PARTIELLE`           | **JAMAIS** (residu mort UI)                  | A eviter                  |

### 4.2 Calculs taxes

Source : `accounting.py:2541-2557` (`_recalculate_invoice`)

```python
total_ht = SUM(lignes.montant)               # Somme des lignes
tps_val = round(total_ht * 0.05, 2)          # TPS 5%
tvq_val = round(total_ht * 0.09975, 2)       # TVQ 9.975%
ttc = round(total_ht + tps_val + tvq_val, 2) # Total TTC
solde_du = ttc - montant_paye
```

**Stockage en base** (`factures` table) :
- `montant_ht`, `montant_tps`, `taux_tps` (= 0.05), `montant_tvq`, `taux_tvq` (= 0.09975), `montant_ttc`, `montant_total` (= TTC, redondant pour compat), `montant_paye`, `solde_du`

> **Taxes au niveau facture** (pas par ligne). Les lignes ont uniquement `montant = qte * prix_unitaire` (HT).
> **Taux fixes** : pas de selection entre HST (TVH 13%/15% autres provinces) ou taxes a 0%. Pour facturer hors-Quebec, modifier manuellement les valeurs apres creation (PUT).

### 4.3 Format numero facture

`FACT-YYYY-NNNNN` ou :
- `YYYY` = annee courante au moment de la creation
- `NNNNN` = id facture zero-padded sur 5

Exemples : `FACT-2026-00001`, `FACT-2026-00031`, `FACT-2027-00001`.

> **Reset par annee** : NON. Le compteur `id` est sequentiel global. Le `YYYY` change mais `NNNNN` continue. Donc en 2027 on peut avoir `FACT-2027-00200` (suite de 2026).

### 4.4 Plan comptable Quebec construction (28 comptes auto-seed)

Source : `accounting.py:42-84` (constante `DEFAULT_COMPTES`).

| Code | Nom                            | Type     | Classe |
|------|--------------------------------|----------|--------|
| 1010 | Encaisse generale              | ACTIF    | 1      |
| 1020 | Petite caisse                  | ACTIF    | 1      |
| 1100 | Comptes clients                | ACTIF    | 1      |
| 1150 | Retenues a recevoir            | ACTIF    | 1      |
| 1200 | TPS a recevoir                 | ACTIF    | 1      |
| 1210 | TVQ a recevoir                 | ACTIF    | 1      |
| 1300 | Stocks materiaux               | ACTIF    | 1      |
| 1500 | Equipement et outillage        | ACTIF    | 1      |
| 1510 | Vehicules                      | ACTIF    | 1      |
| 2100 | Comptes fournisseurs           | PASSIF   | 2      |
| 2150 | Retenues a payer               | PASSIF   | 2      |
| 2200 | TPS a payer                    | PASSIF   | 2      |
| 2210 | TVQ a payer                    | PASSIF   | 2      |
| 2300 | Salaires a payer               | PASSIF   | 2      |
| 2400 | Emprunts bancaires             | PASSIF   | 2      |
| 3100 | Capital                        | CAPITAUX | 3      |
| 3200 | Benefices non repartis         | CAPITAUX | 3      |
| 4100 | Revenus de construction        | REVENU   | 4      |
| 4200 | Revenus de services            | REVENU   | 4      |
| 4900 | Autres revenus                 | REVENU   | 4      |
| 5100 | Cout des materiaux             | CHARGE   | 5      |
| 5200 | Main d oeuvre directe          | CHARGE   | 5      |
| 5300 | Sous-traitance                 | CHARGE   | 5      |
| 5400 | Equipement / location          | CHARGE   | 5      |
| 5500 | Frais de chantier              | CHARGE   | 5      |
| 6100 | Salaires administration        | CHARGE   | 6      |
| 6200 | Loyer / electricite            | CHARGE   | 6      |
| 6900 | Amortissements                 | CHARGE   | 6      |

Auto-seed lors du premier `GET /chart-of-accounts` par tenant (idempotent via ON CONFLICT).

> **Comptes ajoutables** par l utilisateur via UI (POST /chart-of-accounts non documente — a verifier en prod si necessaire).

### 4.5 Types ecritures journal

| Type                  | Origine                        | Debit / Credit auto                         |
|-----------------------|--------------------------------|---------------------------------------------|
| `VENTE`               | Sync facture client            | D 1100 (clients) / C 4100 (revenus) + TPS/TVQ |
| `ACHAT`               | Sync BC ou facture fournisseur | D 5100 (cout) / C 2100 (fournisseurs) + TPS/TVQ |
| `ENCAISSEMENT`        | Paiement facture client        | D 1010 (encaisse) / C 1100 (clients)        |
| `DECAISSEMENT`        | Paiement facture fournisseur   | D 2100 (fournisseurs) / C 1010 (encaisse)   |
| `RETENUE`             | Creation retenue garantie      | D 1150 (retenues) / C 1100 (clients)        |
| `LIBERATION_RETENUE`  | Liberation retenue garantie    | D 1010 (encaisse) / C 1150 (retenues)       |
| `SALAIRE`             | Sync paie employes             | D 5200 (main oeuvre) / C 2300 (salaires)    |
| `AJUSTEMENT`          | Manuel                         | Au choix                                    |
| `AUTRE`               | Manuel                         | Au choix                                    |

### 4.6 Tables PostgreSQL principales

| Table                  | Role                                                     |
|------------------------|----------------------------------------------------------|
| `factures`             | En-tete factures (vente + achat) + cumuls paiements      |
| `factures_lignes`      | Lignes de factures                                       |
| `journal_entries`      | Ecritures journal (en-tete)                              |
| `journal_lignes`       | Lignes ecritures (compte, debit, credit)                 |
| `comptes_comptables`   | Plan comptable                                           |
| `centres_couts`        | Centres de cout                                          |
| `periodes_comptables`  | Periodes comptables (OUVERTE / CLOTUREE)                 |
| `retenues_chantier`    | Retenues de garantie                                     |
| `dossier_factures`     | Lien CRM (auto a la creation si devis_id)                |

### 4.7 Validations & limites

| Regle                                            | Effet                                                  |
|--------------------------------------------------|--------------------------------------------------------|
| `montant <= 0` paiement                          | Pydantic refuse (HTTP 422 `montant > 0`)               |
| Suppression facture (DELETE physique)            | **N existe pas** (uniquement soft-delete via PUT statut) |
| Modification facture en periode CLOTUREE         | **Aucun blocage DB** (cf. FAQ)                         |
| Validation ecriture avec SUM(debit) != SUM(credit) | Bloque (validation Pydantic)                         |
| Scan IA fichier > 20 MB                          | HTTP 413 (Payload Too Large)                           |
| Scan IA credits IA insuffisants                  | HTTP 402 (Payment Required) si solde negatif           |

---

## 5. Integrations & FAQ

### 5.1 Integration Devis

- A la creation d une facture client, le champ optionnel **Devis associe** permet de lier `factures.devis_id` -> `devis.id`.
- Si renseigne, et si le devis appartient a une opportunite CRM avec `dossier_id`, la facture est **auto-rattachee** au dossier via `dossier_factures` (ON CONFLICT DO NOTHING).
- **Pas de pre-remplissage automatique des lignes** depuis le devis : la facture est creee vide, l utilisateur doit ajouter les lignes manuellement.
- Pour copier les lignes du devis vers la facture, utiliser la fonction « Convertir en facture » depuis le module Devis (cf. [04-devis.md](08-ventes-soumissions.md)).

### 5.2 Integration Bons de Commande (BC)

- Pour saisir une facture fournisseur liee a un BC, le champ **BC associe** permet de lier `factures.bon_commande_id`.
- A la suppression du BC, le lien est nullifie (`UPDATE factures SET bon_commande_id = NULL`) — la facture reste.
- Le `sync-depenses` cree automatiquement des ecritures journal `ACHAT` pour les BC en statut `Recu` ou `Facture`.

### 5.3 Periodes cloturees : verrouillage logiciel ou DB ?

> **Verrouillage logiciel uniquement** : la cloture d une periode (statut `CLOTUREE`) ne pose **aucune contrainte DB** sur les inserts/updates dans la periode.

Consequences :
- Vous **pouvez** modifier une facture/ecriture/paiement dans une periode cloturee.
- Le frontend **n affiche pas de message d erreur** dans la plupart des cas.
- La cloture est un **marqueur informatif** pour les rapports (snapshot a la date de cloture).

Recommandation : ne jamais modifier une periode cloturee, et utiliser des ecritures `AJUSTEMENT` dans la periode courante pour corriger les erreurs historiques.

### 5.4 Integration B2B portal

> **Pas d integration** : les factures **ne sont PAS visibles** dans le portail client B2B.

Le portail B2B (`/b2b-portal`) montre les devis, projets et messages au client mais **pas** les factures. Pour transmettre une facture au client, utiliser :
1. Generer HTML/PDF depuis Comptabilite.
2. Envoyer manuellement par email.
3. (Future) Integration Stripe pour paiement en ligne — non implementee dans cette version.

### 5.5 Integration Paie / Salaires

- Endpoint `sync-depenses` agrege les heures employes (`time_entries`) par periode -> cree ecritures `SALAIRE`.
- Calcul : `cout_horaire * SUM(heures)` par employe sur la periode.
- Ecriture : Debit `5200` (Main d oeuvre directe) / Credit `2300` (Salaires a payer).
- Pour finaliser : creer manuellement un paiement (Debit 2300 / Credit 1010).

> **Pas de gestion paie complete** (deductions a la source, T4, RL-1, releves d emploi). Seulement le cout brut pour la comptabilite analytique.

### 5.6 Integration Centres de couts

- A la creation d une facture liee a un projet, le centre de cout `PRJ-{project_id:05d}` est auto-genere si inexistant.
- Les ecritures journal liees au projet portent ce code de centre de cout.
- L onglet **Centres de couts** -> summary affiche le solde par centre (depenses - revenus imputes).

### 5.7 Integration IA / Credits

- Le scan IA facture **deduit des credits** prepayes du tenant (`tenant_settings.ai_credits_balance_usd`).
- Cout : `(tokens_in * 0.003 + tokens_out * 0.015) / 1000 * 1.30` (markup 30%).
- Tracking dans `ai_usage` table (date, model, tokens_in, tokens_out, cost_usd, feature=invoice_scan).
- Si credits insuffisants : HTTP 402 (Payment Required) -> message UI « Veuillez recharger vos credits IA ».

### 5.8 FAQ

**Q : Le format `FACT-AAAA-NNNNN` est correct ?**
R : OUI. `AAAA` = annee (`YYYY` en notation alternative). Le format reel est `FACT-2026-00031`.

**Q : Les paiements sont-ils stockes en table dediee ?**
R : NON. L historique multi-paiements n est PAS conserve. Seul le cumul (`montant_paye`, `solde_du`) et le dernier paiement (`mode_paiement`, `reference_paiement`, `date_paiement`) sont stockes sur la table `factures`. Si vous avez besoin de l historique complet, exporter le journal (les ecritures `ENCAISSEMENT` sont individuelles).

**Q : Quand une facture passe-t-elle automatiquement en statut PAYEE ?**
R : Quand `solde_du <= 0.01` apres enregistrement d un paiement (POST /payment). Tolerance de 1 cent pour eviter les arrondis.

**Q : Que se passe-t-il si je modifie une facture deja payee ?**
R : Aucun blocage. Le solde est recalcule (`solde = ttc - montant_paye`). Si le nouveau TTC > montant paye, le statut peut redescendre en `PARTIELLEMENT_PAYEE`. Dans ce cas, les ecritures journal generees ne sont PAS automatiquement mises a jour — il faut creer une ecriture `AJUSTEMENT` manuelle.

**Q : Les ecritures BROUILLON apparaissent-elles dans les etats financiers ?**
R : NON. Tous les rapports financiers (Bilan, Etat des resultats, Flux de tresorerie, Grand livre, Balance) filtrent uniquement `journal_entries.statut = VALIDEE`. Une ecriture en `BROUILLON` est invisible des rapports.

**Q : Comment scanner une facture en lot (batch) ?**
R : NON supporte. Un seul fichier par appel `POST /invoices/ai/scan`. Pour traiter plusieurs factures, faire des appels successifs (l UI doit gerer la queue).

**Q : Le statut PARTIELLE existe-t-il vraiment ?**
R : NON dans le code backend. C est un residu mort dans `INVOICE_STATUT_COLORS` (UI). Utiliser `PARTIELLEMENT_PAYEE` uniquement.

**Q : Les retenues 10% sont-elles obligatoires au Quebec ?**
R : Le Code civil du Quebec (art. 2123) permet de retenir un pourcentage (typiquement 10%) jusqu a l acceptation finale des travaux pour les contrats > 25 000$. Le module supporte cela via les retenues de garantie. **Ce n est pas auto-applique** : l utilisateur cree manuellement la retenue depuis l onglet Retenues.

**Q : L export QuickBooks fonctionne avec QuickBooks Online ?**
R : NON. L export IIF est un format **QuickBooks Desktop** (Intuit). Pour QuickBooks Online (QBO), utiliser le CSV plus generique ou un connecteur tiers.

**Q : Puis-je annuler une ecriture journal validee ?**
R : NON. Une fois validee, une ecriture est figee. Pour annuler son effet, creer une ecriture inverse de type `AJUSTEMENT` (Debit/Credit inverses). Conservation comptable obligatoire au Quebec (LRAQ — Loi sur les regles applicables).

**Q : Le solde du compte 1010 (Encaisse) doit-il correspondre au solde bancaire reel ?**
R : OUI, en theorie. Toutes les operations qui touchent l encaisse (paiements, decaissements, salaires) creent des ecritures `ENCAISSEMENT` ou `DECAISSEMENT` qui debitent/creditent 1010. En pratique, des ecarts peuvent apparaitre (frais bancaires non saisis, virements en transit). Faire un rapprochement bancaire mensuel via ecritures `AJUSTEMENT`.

**Q : Comment ajouter de la TVH 13/15% pour client hors Quebec ?**
R : **Pas de mode multi-taxes natif**. Apres creation, modifier manuellement les valeurs `taux_tps`, `taux_tvq` ou les montants TPS/TVQ via PUT facture. Solution non-ideale — utiliser facture personnalisee si beaucoup de cas.

**Q : Le module gere-t-il les bons d achat (purchase requisitions) ?**
R : NON. Seulement Bons de Commande -> Factures fournisseurs. Pas de workflow de demande d achat -> approbation -> BC.

**Q : Y a-t-il des notifications par email quand une facture est en retard ?**
R : NON automatique dans cette version. Seul un filtre manuel `EN_RETARD` permet de lister les factures depassant `date_echeance`.

---

## 6. Recap one-pager

- **Format** : `FACT-YYYY-NNNNN` (annee + 5 chiffres). Race-safe.
- **6 statuts** : BROUILLON / ENVOYEE / PAYEE / PARTIELLEMENT_PAYEE / EN_RETARD / ANNULEE. `PARTIELLE` = residu mort.
- **Auto-statut** : PAYEE si solde <= 0.01 ; PARTIELLEMENT_PAYEE si paye > 0 et < TTC.
- **Type** : `client` (Vente) ou `fournisseur` (Achat).
- **Taxes** : TPS 5% + TVQ 9.975% calculees au niveau facture, stockees en base. Pas par ligne.
- **Paiement** : POST /payment cumule sur factures (pas de table paiements). Auto-cree ecriture journal ENCAISSEMENT (D 1010 / C 1100).
- **Soft-delete** : statut ANNULEE. Pas de DELETE physique.
- **Plan comptable** : 28 comptes Quebec construction auto-seed au premier appel.
- **Periodes** : OUVERTE / CLOTUREE — cloture purement informative (pas de blocage DB).
- **Retenues** : table `retenues_chantier`, 10% defaut, cycle RETENUE -> LIBEREE avec ecritures auto.
- **Scan IA** : Claude Sonnet 4.6 + vision/PDF (max 20 MB), deduit credits, retourne JSON.
- **Sync** : sync-all idempotent (factures + paiements + depenses). WHERE journal_entry_id IS NULL.
- **Exports** : QuickBooks IIF natif, Sage 50 CSV, Journal/Balance/Grand livre/Plan comptable/Declaration TPS-TVQ.
- **Pas de B2B portal**, **pas de notifications retard auto**, **pas de TVH multi-province**, **pas de paie complete**.

---

**Documentation generee a partir du code** : `accounting.py` (4426 lignes), `ComptabilitePage.tsx` (2516 lignes), `accounting.ts` (api client).

**Manuels lies** :
- Module 4 (Devis) — `04-devis.md`
- Module 6 (Bons de Commande) — `06-bons-de-commande.md`
- Module 9 (Employes / Pointage) — `09-employes.md`
- Module 25 (IA / Assistant) — `12-ia.md`
