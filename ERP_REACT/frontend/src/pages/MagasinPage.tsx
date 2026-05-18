/**
 * ERP React Frontend - Magasin Page
 * Combined view: Products + Inventory Stats + Suppliers
 * Based on produits.py, inventory.py, fournisseurs.py
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package, Search, Plus, AlertTriangle, Truck, ArrowUpDown,
  DollarSign, Layers, FileText, Trash2, X, Code2, Eye, ChevronLeft, Pencil,
} from 'lucide-react';
import * as inventoryApi from '@/api/inventory';
import * as suppliersApi from '@/api/suppliers';
import * as projectsApi from '@/api/projects';
import type { Product, InventoryStats, StockMovement, BOMComposant, BOMParent } from '@/api/inventory';
import type { Supplier, PurchaseOrder, SupplierCreate, BCLine } from '@/api/suppliers';
import * as companiesApi from '@/api/companies';
import type { Company } from '@/api/companies';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import { SkeletonPage } from '@/components/ui/Skeleton';
import { Alert } from '@/components/ui/Alert';
import StatCard from '@/components/dashboard/StatCard';
import { CommandBar } from '@/components/ui/CommandBar';
import { formatCurrency, formatDate } from '@/utils/format';
import { useSortable } from '@/hooks/useSortable';
import { useColumnResize } from '@/hooks/useColumnResize';
import { SortableHeader } from '@/components/ui/SortableHeader';

type TabKey = 'products' | 'suppliers' | 'orders' | 'movements';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'orders', label: 'Bons de commande', icon: <FileText size={16} /> },
  { key: 'movements', label: 'Mouvements', icon: <ArrowUpDown size={16} /> },
  { key: 'products', label: 'Inventaire', icon: <Package size={16} /> },
  { key: 'suppliers', label: 'Fournisseurs', icon: <Truck size={16} /> },
];

const BC_STATUS_COLORS: Record<string, string> = {
  Brouillon: 'gray',
  brouillon: 'gray',
  Envoye: 'indigo',
  envoye: 'indigo',
  Approuve: 'blue',
  approuve: 'blue',
  Commande: 'purple',
  commande: 'purple',
  Recu: 'teal',
  recu: 'teal',
  Annule: 'red',
  annule: 'red',
};

const TYPE_PRODUIT_OPTIONS = [
  { value: '', label: 'Sélectionner un type' },
  { value: 'Beton et ciment', label: 'Beton et ciment' },
  { value: 'Bois et charpente', label: 'Bois et charpente' },
  { value: 'Acier et metal', label: 'Acier et metal' },
  { value: 'Plomberie', label: 'Plomberie' },
  { value: 'Electricite', label: 'Electricite' },
  { value: 'Isolation', label: 'Isolation' },
  { value: 'Toiture', label: 'Toiture' },
  { value: 'Peinture et finition', label: 'Peinture et finition' },
  { value: 'Quincaillerie', label: 'Quincaillerie' },
  { value: 'Revetement', label: 'Revetement' },
  { value: 'Outillage', label: 'Outillage' },
  { value: 'EPI / Securite', label: 'EPI / Sécurité' },
  { value: 'Autre', label: 'Autre' },
];

const NORME_OPTIONS = [
  { value: '', label: 'Aucune' },
  { value: 'CSA', label: 'CSA - Canadian Standards' },
  { value: 'ASTM', label: 'ASTM International' },
  { value: 'BNQ', label: 'BNQ - Bureau de normalisation' },
  { value: 'ULC', label: 'ULC - Underwriters Laboratories' },
  { value: 'ISO', label: 'ISO' },
  { value: 'LEED', label: 'LEED' },
  { value: 'Autre', label: 'Autre' },
];

const CATEGORIE_PRODUITS_OPTIONS = [
  { value: '', label: 'Sélectionner une catégorie' },
  { value: 'Beton et ciment', label: 'Beton et ciment' },
  { value: 'Bois et charpente', label: 'Bois et charpente' },
  { value: 'Acier et metal', label: 'Acier et metal' },
  { value: 'Plomberie', label: 'Plomberie' },
  { value: 'Electricite', label: 'Electricite' },
  { value: 'Isolation', label: 'Isolation' },
  { value: 'Toiture', label: 'Toiture' },
  { value: 'Peinture et finition', label: 'Peinture et finition' },
  { value: 'Quincaillerie', label: 'Quincaillerie' },
  { value: 'Location equipement', label: 'Location equipement' },
  { value: 'Autre', label: 'Autre' },
];

const CERTIFICATIONS = [
  'RBQ - Regie du batiment',
  'CCQ - Commission de la construction',
  'CNESST - Santé sécurité',
  'ISO 9001:2015',
  'BNQ - Bureau de normalisation',
  'CSA - Canadian Standards',
  'LEED - Batiment durable',
  'Garantie GCR',
  'ACQ - Association construction',
  'APCHQ - Habitation',
];

export default function MagasinPage() {
  const [tab, setTab] = useState<TabKey>('orders');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 20;

  // Stats
  const [stats, setStats] = useState<InventoryStats | null>(null);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [showLowStock, setShowLowStock] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  // Si non-null, le modal est en mode EDITION (sinon mode CREATION).
  // Le formulaire (newProduct) est partage entre les deux modes.
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [newProduct, setNewProduct] = useState({
    nom: '', codeProduit: '', categorie: '', description: '',
    uniteVente: 'unite', prixUnitaire: 0, coutRevient: 0,
    fournisseurPrincipal: '', stockDisponible: 0, stockMinimum: 0,
    emplacementStock: '', notesTechniques: '', materiau: '',
  });

  const resetProductForm = () => {
    setNewProduct({
      nom: '', codeProduit: '', categorie: '', description: '',
      uniteVente: 'unite', prixUnitaire: 0, coutRevient: 0,
      fournisseurPrincipal: '', stockDisponible: 0, stockMinimum: 0,
      emplacementStock: '', notesTechniques: '', materiau: '',
    });
    setEditingProductId(null);
  };

  const openEditProduct = (p: Product) => {
    setEditingProductId(p.id);
    setNewProduct({
      nom: p.nom || '',
      codeProduit: p.codeProduit || '',
      categorie: p.categorie || '',
      description: p.description || '',
      uniteVente: p.uniteVente || 'unite',
      prixUnitaire: p.prixUnitaire || 0,
      coutRevient: p.coutRevient || 0,
      fournisseurPrincipal: p.fournisseurPrincipal || '',
      stockDisponible: p.stockDisponible || 0,
      stockMinimum: p.stockMinimum || 0,
      emplacementStock: p.emplacementStock || '',
      notesTechniques: p.notesTechniques || '',
      materiau: p.materiau || '',
    });
    setShowCreateProduct(true);
  };

  // Product detail + BOM
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [bomComposants, setBomComposants] = useState<BOMComposant[]>([]);
  const [bomParents, setBomParents] = useState<BOMParent[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [addCompForm, setAddCompForm] = useState({ enfantProduitId: '', quantite: '1', unite: '', notes: '' });

  const openProductDetail = async (product: Product) => {
    setSelectedProduct(product);
    setBomLoading(true);
    try {
      const res = await inventoryApi.listComposants(product.id);
      setBomComposants(res.composants || []);
      setBomParents(res.utiliseDans || []);
    } catch { setBomComposants([]); setBomParents([]); }
    setBomLoading(false);
  };

  const handleAddComposant = async () => {
    if (!selectedProduct || !addCompForm.enfantProduitId) return;
    try {
      await inventoryApi.addComposant(selectedProduct.id, {
        enfantProduitId: Number(addCompForm.enfantProduitId),
        quantite: Number(addCompForm.quantite) || 1,
        unite: addCompForm.unite || undefined,
        notes: addCompForm.notes || undefined,
      });
      setAddCompForm({ enfantProduitId: '', quantite: '1', unite: '', notes: '' });
      openProductDetail(selectedProduct);
    } catch (err: any) { setError(err.response?.data?.detail || 'Erreur ajout composant'); }
  };

  const handleDeleteComposant = async (compId: number) => {
    if (!selectedProduct) return;
    try {
      await inventoryApi.deleteComposant(selectedProduct.id, compId);
      openProductDetail(selectedProduct);
    } catch { setError('Erreur suppression composant'); }
  };

  // Suppliers
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersTotal, setSuppliersTotal] = useState(0);

  // Movements
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);

  // Purchase Orders (Bons de commande)
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);

  const { sortedItems: sortedProducts, sortConfig: productSortConfig, requestSort: requestProductSort } = useSortable(products);
  const { sortedItems: sortedSuppliers, sortConfig: supplierSortConfig, requestSort: requestSupplierSort } = useSortable(suppliers);
  const { sortedItems: sortedOrders, sortConfig: orderSortConfig, requestSort: requestOrderSort } = useSortable(orders);
  const { colWidths: colWidthsProducts, startResize: startResizeProducts, autoFit: autoFitProducts } = useColumnResize({ nom: 200, categorie: 140, quantite: 90, seuilAlerte: 90, prixVente: 110, statut: 100, actions: 90 });
  const { colWidths: colWidthsSuppliers, startResize: startResizeSuppliers, autoFit: autoFitSuppliers } = useColumnResize({ nom: 180, categorie: 140, telephone: 130, ville: 120, evaluation: 80, statut: 100 });
  const { colWidths: colWidthsOrders, startResize: startResizeOrders, autoFit: autoFitOrders } = useColumnResize({ numero: 110, fournisseurNom: 160, projetNom: 150, montantTotal: 110, dateCommande: 130, dateLivraisonPrevue: 140, statut: 100 });

  // Inline date editing for orders
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'dateCommande' | 'dateLivraisonPrevue' } | null>(null);
  const saveInlineDate = async (bcId: number, field: 'dateCommande' | 'dateLivraisonPrevue', value: string) => {
    try {
      await suppliersApi.updatePurchaseOrderDates(bcId, { [field]: value || undefined } as any);
      setOrders((prev) => prev.map((o) => o.id === bcId ? { ...o, [field]: value || undefined } : o));
    } catch { setError('Erreur lors de la sauvegarde de la date'); }
    setEditingDateCell(null);
  };

  // Edit Supplier (double-click)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [editSupplierForm, setEditSupplierForm] = useState<Record<string, any>>({});
  const [editSupplierSaving, setEditSupplierSaving] = useState(false);

  // BC Detail + Lines
  const [selectedBC, setSelectedBC] = useState<PurchaseOrder | null>(null);
  const [bcLines, setBcLines] = useState<BCLine[]>([]);
  const [bcLineForm, setBcLineForm] = useState({ produitId: '', description: '', quantite: 1, unite: 'unite', prixUnitaire: 0 });
  const [productsList, setProductsList] = useState<Product[]>([]);
  const [addingLine, setAddingLine] = useState(false);
  const [bcHtmlContent, setBcHtmlContent] = useState('');
  const [showBcHtmlPreview, setShowBcHtmlPreview] = useState(false);
  const [bcHtmlLoading, setBcHtmlLoading] = useState(false);

  // Create Supplier
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState<SupplierCreate>({ companyId: 0 });
  const [supplierCerts, setSupplierCerts] = useState<string[]>([]);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [companiesList, setCompaniesList] = useState<Company[]>([]);

  // Auto-open from ?open= query param (cross-navigation from Dossier 360)
  const [searchParams, setSearchParams] = useSearchParams();
  const autoOpenHandled = useRef(false);
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && !autoOpenHandled.current && orders.length > 0) {
      const bc = orders.find((o) => o.id === Number(openId));
      if (bc) {
        autoOpenHandled.current = true;
        setTab('orders');
        openBCDetail(bc);
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('open');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, orders]);

  // Create Movement
  const [showCreateMovement, setShowCreateMovement] = useState(false);
  const [movementForm, setMovementForm] = useState({ produitId: '', typeMouvement: 'ENTREE', quantite: 0, reference: '', motif: '' });
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementProductsList, setMovementProductsList] = useState<Product[]>([]);

  // Create BC (Bon de commande)
  const [showCreateBC, setShowCreateBC] = useState(false);
  const [bcForm, setBcForm] = useState({ supplierId: '', projectId: '', dateLivraisonPrevue: '', notes: '' });
  const [bcFormLines, setBcFormLines] = useState<{ produitId: string; description: string; quantite: number; unite: string; prixUnitaire: number }[]>([]);
  const [bcLoading, setBcLoading] = useState(false);
  const [bcError, setBcError] = useState<string | null>(null);
  const [bcSuccess, setBcSuccess] = useState<string | null>(null);
  const [projectsList, setProjectsList] = useState<{ id: number; nomProjet: string }[]>([]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await inventoryApi.getInventoryStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await inventoryApi.listProducts({
        page, perPage, search: search || undefined, lowStock: showLowStock || undefined,
      });
      setProducts(res.items);
      setProductsTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page, search, showLowStock]);

  const fetchSuppliers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await suppliersApi.listSuppliers({ page, perPage, search: search || undefined });
      setSuppliers(res.items);
      setSuppliersTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page, search]);

  const fetchOrders = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await suppliersApi.listAllPurchaseOrders({ page, perPage });
      setOrders(res.items);
      setOrdersTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page]);

  const openBCDetail = async (bc: PurchaseOrder) => {
    setSelectedBC(bc);
    setBcLineForm({ produitId: '', description: '', quantite: 1, unite: 'unite', prixUnitaire: 0 });
    try {
      const [linesRes, prodsRes] = await Promise.all([
        suppliersApi.listBCLines(bc.id),
        inventoryApi.listProducts({ perPage: 100 }),
      ]);
      setBcLines(linesRes.items);
      setProductsList(prodsRes.items);
    } catch { /* ignore */ }
  };

  const handleAddBCLine = async () => {
    if (!selectedBC || !bcLineForm.description.trim()) return;
    setAddingLine(true);
    try {
      await suppliersApi.addBCLine(selectedBC.id, {
        produitId: bcLineForm.produitId ? parseInt(bcLineForm.produitId) : undefined,
        description: bcLineForm.description,
        quantite: bcLineForm.quantite,
        unite: bcLineForm.unite,
        prixUnitaire: bcLineForm.prixUnitaire,
      });
      const res = await suppliersApi.listBCLines(selectedBC.id);
      setBcLines(res.items);
      setBcLineForm({ produitId: '', description: '', quantite: 1, unite: 'unite', prixUnitaire: 0 });
      fetchOrders();
    } catch { setError('Erreur ajout ligne'); }
    finally { setAddingLine(false); }
  };

  const handleDeleteBC = async (bcId: number) => {
    if (!confirm('Supprimer ce bon de commande?')) return;
    try {
      await suppliersApi.deletePurchaseOrder(bcId);
      setSelectedBC(null);
      fetchOrders();
      setBcSuccess('Bon de commande supprimé');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Erreur lors de la suppression');
    }
  };

  const handleDeleteBCLine = async (lineId: number) => {
    if (!selectedBC) return;
    try {
      await suppliersApi.deleteBCLine(selectedBC.id, lineId);
      const res = await suppliersApi.listBCLines(selectedBC.id);
      setBcLines(res.items);
      fetchOrders();
    } catch { setError('Erreur suppression ligne'); }
  };

  const handleSelectProduct = (produitId: string) => {
    const prod = productsList.find((p) => String(p.id) === produitId);
    if (prod) {
      setBcLineForm({
        ...bcLineForm,
        produitId,
        description: prod.nom,
        unite: prod.uniteVente || 'unite',
        prixUnitaire: prod.prixUnitaire || prod.coutRevient || 0,
      });
    } else {
      setBcLineForm({ ...bcLineForm, produitId });
    }
  };

  const fetchMovements = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await inventoryApi.listStockMovements({ page, perPage });
      setMovements(res.items);
      setMovementsTotal(res.total);
    } catch { setError('Erreur'); }
    finally { setIsLoading(false); }
  }, [page]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    setPage(1);
  }, [tab, search, showLowStock]);

  useEffect(() => {
    if (tab === 'products') fetchProducts();
    else if (tab === 'suppliers') fetchSuppliers();
    else if (tab === 'orders') fetchOrders();
    else if (tab === 'movements') fetchMovements();
  }, [tab, fetchProducts, fetchSuppliers, fetchOrders, fetchMovements]);

  const openCreateMovement = async () => {
    setMovementForm({ produitId: '', typeMouvement: 'ENTREE', quantite: 0, reference: '', motif: '' });
    try {
      const res = await inventoryApi.listProducts({ perPage: 100 });
      setMovementProductsList(res.items);
    } catch { /* ignore */ }
    setShowCreateMovement(true);
  };

  const handleCreateMovement = async () => {
    const isAjustement = movementForm.typeMouvement === 'AJUSTEMENT';
    if (!movementForm.produitId || (!isAjustement && movementForm.quantite <= 0) || (isAjustement && movementForm.quantite < 0)) return;
    setMovementLoading(true);
    try {
      await inventoryApi.createStockMovement({
        produitId: parseInt(movementForm.produitId),
        typeMouvement: movementForm.typeMouvement,
        quantite: movementForm.quantite,
        reference: movementForm.reference || undefined,
        motif: movementForm.motif || undefined,
      });
      setShowCreateMovement(false);
      fetchMovements();
      fetchStats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || msg || 'Erreur lors de la création du mouvement');
    } finally {
      setMovementLoading(false);
    }
  };

  const fetchProjectsForDropdown = useCallback(async () => {
    try {
      const res = await projectsApi.listProjects({ page: 1, perPage: 100 });
      setProjectsList(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const fetchCompaniesForDropdown = useCallback(async () => {
    try {
      const res = await companiesApi.listCompanies({ perPage: 100 });
      setCompaniesList(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const openCreateSupplier = () => {
    setSupplierForm({ companyId: 0 });
    setSupplierCerts([]);
    fetchCompaniesForDropdown();
    setShowCreateSupplier(true);
  };

  const toggleCert = (cert: string) => {
    setSupplierCerts((prev) =>
      prev.includes(cert) ? prev.filter((c) => c !== cert) : [...prev, cert]
    );
  };

  const handleCreateSupplier = async () => {
    if (!supplierForm.companyId) return;
    setSupplierLoading(true);
    try {
      const payload: SupplierCreate = {
        ...supplierForm,
        certifications: supplierCerts.length > 0 ? supplierCerts.join(', ') : undefined,
      };
      await suppliersApi.createSupplier(payload);
      setShowCreateSupplier(false);
      setBcSuccess('Fournisseur créé');
      fetchSuppliers();
    } catch {
      setError('Erreur lors de la création du fournisseur');
    } finally {
      setSupplierLoading(false);
    }
  };

  const openEditSupplier = (s: Supplier) => {
    setEditSupplierForm({
      nomFournisseur: s.nomFournisseur || s.nom || '',
      categorieProduits: s.categorieProduits || s.categorie || '',
      conditionsPaiement: s.conditionsPaiement || '',
      contactCommercial: s.contactCommercial || '',
      contactTechnique: s.contactTechnique || '',
      delaiLivraisonMoyen: s.delaiLivraisonMoyen ?? '',
      evaluationQualite: s.evaluationQualite || s.evaluation || 5,
      notes: s.notes || '',
      notesEvaluation: s.notesEvaluation || '',
      estActif: s.estActif ?? s.actif ?? true,
    });
    setEditSupplier(s);
  };

  const handleSaveSupplier = async () => {
    if (!editSupplier) return;
    setEditSupplierSaving(true);
    try {
      await suppliersApi.updateSupplier(editSupplier.id, editSupplierForm);
      setEditSupplier(null);
      setBcSuccess('Fournisseur mis à jour');
      fetchSuppliers();
    } catch { setError('Erreur lors de la mise à jour'); }
    finally { setEditSupplierSaving(false); }
  };

  const openCreateBC = () => {
    setBcForm({ supplierId: '', projectId: '', dateLivraisonPrevue: '', notes: '' });
    setBcFormLines([]);
    setBcError(null);
    setBcSuccess(null);
    fetchProjectsForDropdown();
    // Load products for article picker
    inventoryApi.listProducts({ perPage: 100 }).then((res) => setProductsList(res.items)).catch(() => {});
    setShowCreateBC(true);
  };

  const addBcFormLine = () => {
    setBcFormLines((prev) => [...prev, { produitId: '', description: '', quantite: 1, unite: 'unite', prixUnitaire: 0 }]);
  };

  const updateBcFormLine = (idx: number, field: string, value: any) => {
    setBcFormLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const removeBcFormLine = (idx: number) => {
    setBcFormLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const selectProductForBcLine = (idx: number, produitId: string) => {
    const prod = productsList.find((p) => String(p.id) === produitId);
    if (prod) {
      setBcFormLines((prev) => prev.map((l, i) => i === idx ? {
        ...l, produitId, description: prod.nom,
        unite: prod.uniteVente || 'unite',
        prixUnitaire: prod.prixUnitaire || prod.coutRevient || 0,
      } : l));
    } else {
      updateBcFormLine(idx, 'produitId', produitId);
    }
  };

  const bcFormTotal = bcFormLines.reduce((sum, l) => sum + (l.quantite * l.prixUnitaire), 0);

  const handleCreateBC = async () => {
    if (!bcForm.supplierId) return;
    setBcLoading(true);
    setBcError(null);
    try {
      const res = await suppliersApi.createPurchaseOrder(parseInt(bcForm.supplierId), {
        projectId: bcForm.projectId ? parseInt(bcForm.projectId) : undefined,
        dateLivraisonPrevue: bcForm.dateLivraisonPrevue || undefined,
        notes: bcForm.notes || undefined,
      });
      // Add lines
      for (const line of bcFormLines.filter((l) => l.description.trim())) {
        try {
          await suppliersApi.addBCLine(res.id, {
            produitId: line.produitId ? parseInt(line.produitId) : undefined,
            description: line.description,
            quantite: line.quantite,
            unite: line.unite,
            prixUnitaire: line.prixUnitaire,
          });
        } catch { /* continue */ }
      }
      setShowCreateBC(false);
      setBcSuccess(`Bon de commande ${res.numero} créé`);
      setTab('orders');
      fetchOrders();
    } catch {
      setBcError('Erreur lors de la création du bon de commande');
    } finally {
      setBcLoading(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!newProduct.nom.trim() || productSaving) return;
    setProductSaving(true);
    try {
      if (editingProductId !== null) {
        // Mode EDITION: on n'envoie PAS stockDisponible (audit trail via mouvements
        // d'AJUSTEMENT uniquement — le champ est read-only dans le modal).
        const { stockDisponible: _omit, ...editable } = newProduct;
        await inventoryApi.updateProduct(editingProductId, editable);
        setBcSuccess('Article mis a jour');
        // Si la fiche detail est ouverte sur ce produit, la rafraichir
        if (selectedProduct && selectedProduct.id === editingProductId) {
          try {
            const refreshed = await inventoryApi.getProduct(editingProductId);
            setSelectedProduct(refreshed as Product);
          } catch { /* non bloquant */ }
        }
      } else {
        await inventoryApi.createProduct(newProduct);
        setBcSuccess('Article ajoute');
      }
      setShowCreateProduct(false);
      resetProductForm();
      fetchProducts();
      fetchStats();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Erreur lors de la sauvegarde du produit');
    } finally {
      setProductSaving(false);
    }
  };

  const totalPages = Math.ceil(
    (tab === 'products' ? productsTotal : tab === 'suppliers' ? suppliersTotal : tab === 'orders' ? ordersTotal : movementsTotal) / perPage
  );

  return (
    <div className="space-y-4">
      {error && <Alert type="error" onClose={() => setError(null)}>{error}</Alert>}
      {bcSuccess && <Alert type="success" onClose={() => setBcSuccess(null)}>{bcSuccess}</Alert>}

      <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">Magasin</h2>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Produits" value={stats.totalProduits} icon={<Package size={20} />} color="blue" />
          <StatCard label="Alertes stock" value={stats.alertesStock} icon={<AlertTriangle size={20} />} color={stats.alertesStock > 0 ? 'red' : 'green'} />
          <StatCard label="Valeur inventaire" value={formatCurrency(stats.valeurInventaire)} icon={<DollarSign size={20} />} color="green" />
          <StatCard label="Catégories" value={stats.nbCategories} icon={<Layers size={20} />} color="purple" />
        </div>
      )}

      {/* Tabs */}
      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1 whitespace-nowrap min-w-max md:min-w-0">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-seaop-primary-600 text-seaop-primary-600 dark:text-seaop-primary-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
        </div>
      </div>

      {/* Command Bar per tab */}
      {tab === 'products' && (
        <CommandBar
          actions={[
            { label: 'Nouvel Article', icon: <Plus size={14} />, onClick: () => setShowCreateProduct(true), variant: 'primary' },
            { label: 'Stock bas', icon: <AlertTriangle size={14} />, onClick: () => setShowLowStock(!showLowStock), variant: showLowStock ? 'danger' : 'default' },
          ]}
          right={
            <div className="relative min-w-[140px] sm:min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9" />
            </div>
          }
        />
      )}
      {tab === 'suppliers' && (
        <CommandBar
          actions={[
            { label: 'Nouveau Fournisseur', icon: <Plus size={14} />, onClick: openCreateSupplier, variant: 'primary' },
            { label: 'Nouveau bon de commande', icon: <Plus size={14} />, onClick: openCreateBC },
          ]}
          right={
            <div className="relative min-w-[140px] sm:min-w-[200px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..." className="erp-input pl-9" />
            </div>
          }
        />
      )}
      {tab === 'orders' && (
        <CommandBar
          actions={[
            { label: 'Nouveau bon de commande', icon: <Plus size={14} />, onClick: openCreateBC, variant: 'primary' },
          ]}
        />
      )}
      {tab === 'movements' && (
        <CommandBar
          actions={[
            { label: 'Nouveau mouvement', icon: <Plus size={14} />, onClick: openCreateMovement, variant: 'primary' },
          ]}
        />
      )}

      {isLoading ? (
        <SkeletonPage />
      ) : (
        <>
          {/* PRODUCTS TABLE */}
          {tab === 'products' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <SortableHeader label="Produit" sortKey="nom" sortConfig={productSortConfig} onSort={requestProductSort} align="left" width={colWidthsProducts.nom} onResizeStart={(e) => startResizeProducts(e, 'nom')} onAutoFit={(e) => autoFitProducts(e, 'nom')} />
                        <SortableHeader label="Catégorie" sortKey="categorie" sortConfig={productSortConfig} onSort={requestProductSort} align="left" width={colWidthsProducts.categorie} onResizeStart={(e) => startResizeProducts(e, 'categorie')} onAutoFit={(e) => autoFitProducts(e, 'categorie')} />
                        <SortableHeader label="Stock" sortKey="quantite" sortConfig={productSortConfig} onSort={requestProductSort} align="right" width={colWidthsProducts.quantite} onResizeStart={(e) => startResizeProducts(e, 'quantite')} onAutoFit={(e) => autoFitProducts(e, 'quantite')} />
                        <SortableHeader label="Seuil" sortKey="seuilAlerte" sortConfig={productSortConfig} onSort={requestProductSort} align="right" width={colWidthsProducts.seuilAlerte} onResizeStart={(e) => startResizeProducts(e, 'seuilAlerte')} onAutoFit={(e) => autoFitProducts(e, 'seuilAlerte')} />
                        <SortableHeader label="Prix vente" sortKey="prixVente" sortConfig={productSortConfig} onSort={requestProductSort} align="right" width={colWidthsProducts.prixVente} onResizeStart={(e) => startResizeProducts(e, 'prixVente')} onAutoFit={(e) => autoFitProducts(e, 'prixVente')} />
                        <SortableHeader label="Statut" sortKey="statut" sortConfig={productSortConfig} onSort={requestProductSort} align="center" width={colWidthsProducts.statut} onResizeStart={(e) => startResizeProducts(e, 'statut')} onAutoFit={(e) => autoFitProducts(e, 'statut')} />
                        <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400" style={{ width: colWidthsProducts.actions }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedProducts.map((p) => {
                        const isLow = p.stockMinimum > 0 && p.stockDisponible <= p.stockMinimum;
                        return (
                          <tr key={p.id} className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selectedProduct?.id === p.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`} onClick={() => openProductDetail(p)}>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900 dark:text-white">{p.nom}</div>
                              {p.codeProduit && <div className="text-xs text-gray-400">{p.codeProduit}</div>}
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{p.categorie || '--'}</td>
                            <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                              {p.stockDisponible} {p.uniteVente}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-500">{p.stockMinimum}</td>
                            <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-400">
                              {p.prixUnitaire ? formatCurrency(p.prixUnitaire) : '--'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge color={isLow ? 'red' : 'green'} size="sm">
                                {isLow ? 'Bas' : 'OK'}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openEditProduct(p); }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-seaop-primary-600 dark:text-seaop-primary-400 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 rounded transition-colors"
                                title="Modifier l'article"
                              >
                                <Pencil size={14} />
                                <span className="hidden lg:inline">Modifier</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {products.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Aucun produit</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {products.map((p) => {
                  const isLow = p.stockMinimum > 0 && p.stockDisponible <= p.stockMinimum;
                  return (
                    <Card key={p.id} padding="sm" onClick={() => openProductDetail(p)} className="cursor-pointer">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 dark:text-white truncate">{p.nom}</p>
                          {p.codeProduit && <p className="text-xs text-gray-400">{p.codeProduit}</p>}
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{p.categorie || '--'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge color={isLow ? 'red' : 'green'} size="sm">
                            {isLow ? 'Bas' : 'OK'}
                          </Badge>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openEditProduct(p); }}
                            className="p-1.5 text-seaop-primary-600 dark:text-seaop-primary-400 hover:bg-seaop-primary-50 dark:hover:bg-seaop-primary-900/20 rounded"
                            title="Modifier l'article"
                          >
                            <Pencil size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                        <span className="text-gray-500">Stock: <span className="font-medium text-gray-900 dark:text-white">{p.stockDisponible} {p.uniteVente}</span></span>
                        <span className="text-gray-500">Prix: <span className="font-medium text-gray-600 dark:text-gray-400">{p.prixUnitaire ? formatCurrency(p.prixUnitaire) : '--'}</span></span>
                      </div>
                    </Card>
                  );
                })}
                {products.length === 0 && (
                  <p className="px-4 py-8 text-center text-gray-400">Aucun produit</p>
                )}
              </div>

              {/* BOM Detail Panel */}
              {selectedProduct && (
                <Card className="mt-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedProduct.nom}</h3>
                      {selectedProduct.codeProduit && <p className="text-xs text-gray-400">{selectedProduct.codeProduit}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditProduct(selectedProduct)}
                        title="Modifier l'article"
                      >
                        <Pencil size={14} className="mr-1" /> Modifier
                      </Button>
                      <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                    </div>
                  </div>

                  {/* Composants (enfants) */}
                  <div className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Composants ({bomComposants.length})</h4>
                    {bomLoading ? (
                      <p className="text-sm text-gray-400">Chargement...</p>
                    ) : bomComposants.length > 0 ? (
                      <table className="w-full text-sm mb-3">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500">
                            <th className="px-2 py-1.5 text-left">Produit</th>
                            <th className="px-2 py-1.5 text-right">Quantité</th>
                            <th className="px-2 py-1.5 text-left">Unité</th>
                            <th className="px-2 py-1.5 text-right">Prix unit.</th>
                            <th className="px-2 py-1.5 text-right">Stock</th>
                            <th className="px-2 py-1.5 text-left">Notes</th>
                            <th className="px-2 py-1.5 w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {bomComposants.map((c) => (
                            <tr key={c.id}>
                              <td className="px-2 py-1.5">
                                <span className="font-medium text-gray-900 dark:text-white">{c.enfantNom}</span>
                                {c.enfantCode && <span className="text-xs text-gray-400 ml-1">({c.enfantCode})</span>}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium">{c.quantite}</td>
                              <td className="px-2 py-1.5 text-gray-500">{c.unite || c.uniteVente || '--'}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{c.prixUnitaire ? formatCurrency(c.prixUnitaire) : '--'}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{c.stockDisponible ?? '--'}</td>
                              <td className="px-2 py-1.5 text-gray-400 text-xs truncate max-w-[120px]">{c.notes || '--'}</td>
                              <td className="px-2 py-1.5">
                                <button onClick={() => handleDeleteComposant(c.id)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-gray-400 mb-3">Aucun composant</p>
                    )}

                    {/* Add component form */}
                    <div className="flex items-end gap-2 flex-wrap">
                      <div className="flex-1 min-w-[150px]">
                        <label className="text-xs text-gray-500 block mb-0.5">Produit composant</label>
                        <select className="erp-input text-sm w-full" value={addCompForm.enfantProduitId} onChange={(e) => setAddCompForm({ ...addCompForm, enfantProduitId: e.target.value })}>
                          <option value="">Sélectionner...</option>
                          {products.filter((p) => p.id !== selectedProduct.id).map((p) => (
                            <option key={p.id} value={p.id}>{p.nom}{p.codeProduit ? ` (${p.codeProduit})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-500 block mb-0.5">Qte</label>
                        <input type="number" className="erp-input text-sm w-full" value={addCompForm.quantite} onChange={(e) => setAddCompForm({ ...addCompForm, quantite: e.target.value })} min="0.01" step="any" />
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-500 block mb-0.5">Unité</label>
                        <input type="text" className="erp-input text-sm w-full" value={addCompForm.unite} onChange={(e) => setAddCompForm({ ...addCompForm, unite: e.target.value })} placeholder="unite" />
                      </div>
                      <button onClick={handleAddComposant} disabled={!addCompForm.enfantProduitId} className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">+ Ajouter</button>
                    </div>
                  </div>

                  {/* Utilise dans (parents) */}
                  {bomParents.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Utilise dans ({bomParents.length})</h4>
                      <div className="space-y-1">
                        {bomParents.map((bp) => (
                          <div key={bp.id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium">{bp.parentNom}</span>
                            {bp.parentCode && <span className="text-xs text-gray-400">({bp.parentCode})</span>}
                            <span className="text-gray-400">- Qte: {bp.quantite} {bp.unite || ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </>
          )}

          {/* SUPPLIERS TABLE */}
          {tab === 'suppliers' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <SortableHeader label="Fournisseur" sortKey="nom" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="left" width={colWidthsSuppliers.nom} onResizeStart={(e) => startResizeSuppliers(e, 'nom')} onAutoFit={(e) => autoFitSuppliers(e, 'nom')} />
                        <SortableHeader label="Catégorie" sortKey="categorie" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="left" width={colWidthsSuppliers.categorie} onResizeStart={(e) => startResizeSuppliers(e, 'categorie')} onAutoFit={(e) => autoFitSuppliers(e, 'categorie')} />
                        <SortableHeader label="Contact" sortKey="telephone" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="left" width={colWidthsSuppliers.telephone} onResizeStart={(e) => startResizeSuppliers(e, 'telephone')} onAutoFit={(e) => autoFitSuppliers(e, 'telephone')} />
                        <SortableHeader label="Ville" sortKey="ville" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="left" width={colWidthsSuppliers.ville} onResizeStart={(e) => startResizeSuppliers(e, 'ville')} onAutoFit={(e) => autoFitSuppliers(e, 'ville')} />
                        <SortableHeader label="Eval." sortKey="evaluation" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="center" width={colWidthsSuppliers.evaluation} onResizeStart={(e) => startResizeSuppliers(e, 'evaluation')} onAutoFit={(e) => autoFitSuppliers(e, 'evaluation')} />
                        <SortableHeader label="Statut" sortKey="statut" sortConfig={supplierSortConfig} onSort={requestSupplierSort} align="center" width={colWidthsSuppliers.statut} onResizeStart={(e) => startResizeSuppliers(e, 'statut')} onAutoFit={(e) => autoFitSuppliers(e, 'statut')} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {sortedSuppliers.map((s) => (
                        <tr key={s.id} onDoubleClick={() => openEditSupplier(s)} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 cursor-pointer">
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 dark:text-white">{s.nom}</div>
                            {s.email && <div className="text-xs text-gray-400">{s.email}</div>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.categorie || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.contactNom || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.ville || '--'}</td>
                          <td className="px-4 py-3 text-center">
                            {s.evaluation ? (
                              <span className="text-amber-500">{(s.evaluation ?? 0).toFixed(1)}/5</span>
                            ) : '--'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge color={s.actif ? 'green' : 'red'} size="sm">
                              {s.actif ? 'Actif' : 'Inactif'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {suppliers.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Aucun fournisseur</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {suppliers.map((s) => (
                  <Card key={s.id} padding="sm" className="cursor-pointer" onClick={() => openEditSupplier(s)}>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{s.nom}</p>
                        {s.email && <p className="text-xs text-gray-400">{s.email}</p>}
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{s.categorie || '--'}</p>
                      </div>
                      <Badge color={s.actif ? 'green' : 'red'} size="sm">
                        {s.actif ? 'Actif' : 'Inactif'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                      <span className="text-gray-500">Contact: <span className="text-gray-700 dark:text-gray-300">{s.contactNom || '--'}</span></span>
                      {s.evaluation ? (
                        <span className="text-amber-500">{(s.evaluation ?? 0).toFixed(1)}/5</span>
                      ) : <span className="text-gray-400">--</span>}
                    </div>
                  </Card>
                ))}
                {suppliers.length === 0 && (
                  <p className="px-4 py-8 text-center text-gray-400">Aucun fournisseur</p>
                )}
              </div>
            </>
          )}

          {/* PURCHASE ORDERS TABLE + DETAIL */}
          {tab === 'orders' && (
            <div className="flex flex-col md:flex-row gap-6">
              {/* Desktop list + mobile list (hidden when detail open on mobile) */}
              <div className={`flex-1 ${selectedBC ? 'hidden md:block max-w-[55%]' : ''}`}>
                {/* Desktop table */}
                <Card padding="sm" className="hidden md:block">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                          <SortableHeader label="Numéro" sortKey="numero" sortConfig={orderSortConfig} onSort={requestOrderSort} align="left" width={colWidthsOrders.numero} onResizeStart={(e) => startResizeOrders(e, 'numero')} onAutoFit={(e) => autoFitOrders(e, 'numero')} />
                          <SortableHeader label="Fournisseur" sortKey="fournisseurNom" sortConfig={orderSortConfig} onSort={requestOrderSort} align="left" width={colWidthsOrders.fournisseurNom} onResizeStart={(e) => startResizeOrders(e, 'fournisseurNom')} onAutoFit={(e) => autoFitOrders(e, 'fournisseurNom')} />
                          <SortableHeader label="Projet" sortKey="projetNom" sortConfig={orderSortConfig} onSort={requestOrderSort} align="left" width={colWidthsOrders.projetNom} onResizeStart={(e) => startResizeOrders(e, 'projetNom')} onAutoFit={(e) => autoFitOrders(e, 'projetNom')} />
                          <SortableHeader label="Montant" sortKey="montantTotal" sortConfig={orderSortConfig} onSort={requestOrderSort} align="right" width={colWidthsOrders.montantTotal} onResizeStart={(e) => startResizeOrders(e, 'montantTotal')} onAutoFit={(e) => autoFitOrders(e, 'montantTotal')} />
                          <SortableHeader label="Date Commande" sortKey="dateCommande" sortConfig={orderSortConfig} onSort={requestOrderSort} align="left" width={colWidthsOrders.dateCommande} onResizeStart={(e) => startResizeOrders(e, 'dateCommande')} onAutoFit={(e) => autoFitOrders(e, 'dateCommande')} />
                          <SortableHeader label="Livraison Prévue" sortKey="dateLivraisonPrevue" sortConfig={orderSortConfig} onSort={requestOrderSort} align="left" width={colWidthsOrders.dateLivraisonPrevue} onResizeStart={(e) => startResizeOrders(e, 'dateLivraisonPrevue')} onAutoFit={(e) => autoFitOrders(e, 'dateLivraisonPrevue')} />
                          <SortableHeader label="Statut" sortKey="statut" sortConfig={orderSortConfig} onSort={requestOrderSort} align="center" width={colWidthsOrders.statut} onResizeStart={(e) => startResizeOrders(e, 'statut')} onAutoFit={(e) => autoFitOrders(e, 'statut')} />
                          <th className="px-4 py-3 w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {sortedOrders.map((o) => (
                          <tr
                            key={o.id}
                            onClick={() => openBCDetail(o)}
                            className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30 ${selectedBC?.id === o.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          >
                            <td className="px-4 py-3">
                              <span className="font-medium text-seaop-primary-600 dark:text-seaop-primary-400">{o.numero}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-900 dark:text-white">{o.fournisseurNom || '--'}</td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{o.nomProjet || '--'}</td>
                            <td className="px-4 py-3 text-right text-gray-600">{o.montantTotal ? formatCurrency(o.montantTotal) : '0,00 $'}</td>
                            <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: o.id, field: 'dateCommande' }); }}>
                              {editingDateCell?.id === o.id && editingDateCell.field === 'dateCommande' ? (
                                <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={o.dateCommande || ''} onChange={(e) => saveInlineDate(o.id, 'dateCommande', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                              ) : (formatDate(o.dateCommande) || '--')}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingDateCell({ id: o.id, field: 'dateLivraisonPrevue' }); }}>
                              {editingDateCell?.id === o.id && editingDateCell.field === 'dateLivraisonPrevue' ? (
                                <input type="date" autoFocus className="border border-blue-400 rounded px-1 py-0.5 text-xs bg-white dark:bg-gray-800" defaultValue={o.dateLivraisonPrevue || ''} onChange={(e) => saveInlineDate(o.id, 'dateLivraisonPrevue', e.target.value)} onBlur={() => setEditingDateCell(null)} onClick={(e) => e.stopPropagation()} />
                              ) : (formatDate(o.dateLivraisonPrevue) || '--')}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge color={(BC_STATUS_COLORS[o.statut] || 'gray') as any} size="sm">{o.statut}</Badge>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteBC(o.id); }} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 transition-colors" title="Supprimer"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                        {orders.length === 0 && (
                          <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucun bon de commande</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
                {/* Mobile cards for orders list */}
                <div className="md:hidden space-y-3">
                  {orders.map((o) => (
                    <Card key={o.id} padding="sm" className="cursor-pointer" onClick={() => openBCDetail(o)}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-seaop-primary-600 dark:text-seaop-primary-400">{o.numero}</p>
                          <p className="text-sm text-gray-900 dark:text-white">{o.fournisseurNom || '--'}</p>
                          {o.nomProjet && <p className="text-xs text-gray-500 dark:text-gray-400">{o.nomProjet}</p>}
                        </div>
                        <Badge color={(BC_STATUS_COLORS[o.statut] || 'gray') as any} size="sm">{o.statut}</Badge>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm text-right">
                        <span className="font-medium text-gray-600">{o.montantTotal ? formatCurrency(o.montantTotal) : '0,00 $'}</span>
                      </div>
                    </Card>
                  ))}
                  {orders.length === 0 && (
                    <p className="px-4 py-8 text-center text-gray-400">Aucun bon de commande</p>
                  )}
                </div>
              </div>

              {/* BC Detail Panel */}
              {selectedBC && (
                <div className="w-full md:w-[45%] md:min-w-[320px]">
                  <Card>
                    {/* Mobile back button */}
                    <button onClick={() => setSelectedBC(null)} className="md:hidden flex items-center gap-1 text-sm text-seaop-primary-600 dark:text-seaop-primary-400 mb-3">
                      <ChevronLeft size={16} /> Retour aux bons de commande
                    </button>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-xs font-mono text-seaop-primary-600">{selectedBC.numero}</p>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {selectedBC.fournisseurNom || 'Fournisseur'}
                        </h3>
                        {selectedBC.nomProjet && (
                          <p className="text-sm text-gray-500">Projet: {selectedBC.nomProjet}</p>
                        )}
                      </div>
                      <button onClick={() => setSelectedBC(null)} className="hidden md:block p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800">
                        <X size={16} />
                      </button>
                    </div>

                    <Badge color={(BC_STATUS_COLORS[selectedBC.statut] || 'gray') as any} size="sm">
                      {selectedBC.statut}
                    </Badge>

                    {/* Sous-totaux rapides */}
                    {bcLines.length > 0 && (() => {
                      const sousTotal = bcLines.reduce((sum, l) => sum + l.montant, 0);
                      const tpsVal = Math.round(sousTotal * 0.05 * 100) / 100;
                      const tvqVal = Math.round(sousTotal * 0.09975 * 100) / 100;
                      const totalTtc = Math.round((sousTotal + tpsVal + tvqVal) * 100) / 100;
                      return (
                        <div className="mt-3 space-y-1 text-sm">
                          <div className="flex justify-between text-gray-500"><span>Sous-total HT</span><span>{formatCurrency(sousTotal)}</span></div>
                          <div className="flex justify-between text-gray-500"><span>TPS (5%)</span><span>{formatCurrency(tpsVal)}</span></div>
                          <div className="flex justify-between text-gray-500"><span>TVQ (9.975%)</span><span>{formatCurrency(tvqVal)}</span></div>
                          <div className="flex justify-between font-bold text-gray-900 dark:text-white border-t border-gray-200 dark:border-gray-700 pt-1">
                            <span>Total TTC</span><span>{formatCurrency(totalTtc)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Action buttons: HTML + Aperçu + Envoyer */}
                    <div className="mt-4 flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<Code2 size={14} />}
                        onClick={async () => {
                          setBcHtmlLoading(true);
                          try {
                            const res = await suppliersApi.generateBCHtml(selectedBC.id);
                            setBcHtmlContent(res.html);
                            setShowBcHtmlPreview(true);
                          } catch {
                            setError('Erreur lors de la generation HTML');
                          } finally {
                            setBcHtmlLoading(false);
                          }
                        }}
                        isLoading={bcHtmlLoading}
                      >
                        Générer HTML
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<Eye size={14} />}
                        onClick={async () => {
                          setBcHtmlLoading(true);
                          try {
                            const res = await suppliersApi.generateBCHtml(selectedBC.id);
                            setBcHtmlContent(res.html);
                            setShowBcHtmlPreview(true);
                          } catch {
                            setError('Erreur lors de la generation HTML');
                          } finally {
                            setBcHtmlLoading(false);
                          }
                        }}
                        disabled={bcHtmlLoading}
                      >
                        Aperçu
                      </Button>
                    </div>

                    {/* Add line form */}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                        Ajouter un article
                      </h4>
                      <Select
                        label="Article d'inventaire"
                        options={[
                          { value: '', label: 'Sélectionner un produit...' },
                          ...productsList.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''}` })),
                        ]}
                        value={bcLineForm.produitId}
                        onChange={(e) => handleSelectProduct(e.target.value)}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                        <Input label="Description" value={bcLineForm.description} onChange={(e) => setBcLineForm({ ...bcLineForm, description: e.target.value })} />
                        <Input label="Qte" type="number" value={bcLineForm.quantite} onChange={(e) => setBcLineForm({ ...bcLineForm, quantite: parseFloat(e.target.value) || 0 })} />
                        <Input label="Prix unit. ($)" type="number" value={bcLineForm.prixUnitaire || ''} onChange={(e) => setBcLineForm({ ...bcLineForm, prixUnitaire: parseFloat(e.target.value) || 0 })} />
                      </div>
                      <div className="mt-2">
                        <Button size="sm" leftIcon={<Plus size={14} />} onClick={handleAddBCLine} isLoading={addingLine} disabled={!bcLineForm.description.trim()}>
                          Ajouter
                        </Button>
                      </div>
                    </div>

                    {/* Lines list */}
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Lignes ({bcLines.length})
                      </h4>
                      {bcLines.length > 0 ? (
                        <div className="space-y-2">
                          {bcLines.map((line) => (
                            <div key={line.id} className="flex items-center justify-between p-2 rounded border border-gray-100 dark:border-gray-800">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{line.description}</p>
                                <p className="text-xs text-gray-400">
                                  {line.quantite} {line.unite || ''} x {formatCurrency(line.prixUnitaire)} = <span className="font-semibold text-gray-600">{formatCurrency(line.montant)}</span>
                                </p>
                              </div>
                              <button onClick={() => handleDeleteBCLine(line.id)} className="p-1 ml-2 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          <div className="pt-2 text-right">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                              Total: {formatCurrency(bcLines.reduce((sum, l) => sum + l.montant, 0))}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">Aucune ligne. Ajoutez des articles ci-dessus.</p>
                      )}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* MOVEMENTS TABLE */}
          {tab === 'movements' && (
            <>
              {/* Desktop table */}
              <Card padding="sm" className="hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Produit</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Quantité</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Référence</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-3 text-gray-900 dark:text-white">{m.produitNom || `#${m.produitId}`}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge color={m.typeMouvement === 'ENTREE' ? 'green' : m.typeMouvement === 'SORTIE' ? 'red' : 'blue'} size="sm">
                              {m.typeMouvement}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{m.quantite}</td>
                          <td className="px-4 py-3 text-gray-500">{m.referenceDocument || '--'}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{m.createdAt || '--'}</td>
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Aucun mouvement</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {movements.map((m) => (
                  <Card key={m.id} padding="sm">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white">{m.produitNom || `#${m.produitId}`}</p>
                        <p className="text-xs text-gray-400 mt-1">{m.referenceDocument || '--'}</p>
                      </div>
                      <Badge color={m.typeMouvement === 'ENTREE' ? 'green' : m.typeMouvement === 'SORTIE' ? 'red' : 'blue'} size="sm">
                        {m.typeMouvement}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-800 text-sm">
                      <span className="font-medium text-gray-900 dark:text-white">Qte: {m.quantite}</span>
                      <span className="text-xs text-gray-400">{m.createdAt || '--'}</span>
                    </div>
                  </Card>
                ))}
                {movements.length === 0 && (
                  <p className="px-4 py-8 text-center text-gray-400">Aucun mouvement</p>
                )}
              </div>
            </>
          )}

          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}

      {/* Create Movement Modal */}
      <Modal isOpen={showCreateMovement} onClose={() => setShowCreateMovement(false)} title="Nouveau mouvement de stock" size="md">
        <div className="space-y-4">
          <Select
            label="Produit *"
            value={movementForm.produitId}
            onChange={(e) => setMovementForm({ ...movementForm, produitId: e.target.value })}
            options={[
              { value: '', label: 'Sélectionner un produit' },
              ...movementProductsList.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''} — Stock: ${p.stockDisponible} ${p.uniteVente || ''}` })),
            ]}
          />
          <Select
            label="Type de mouvement *"
            value={movementForm.typeMouvement}
            onChange={(e) => setMovementForm({ ...movementForm, typeMouvement: e.target.value })}
            options={[
              { value: 'ENTREE', label: 'Entrée (reception, achat, retour)' },
              { value: 'SORTIE', label: 'Sortie (envoi chantier, utilisation)' },
              { value: 'AJUSTEMENT', label: 'Ajustement (correction inventaire)' },
            ]}
          />
          <Input
            label={movementForm.typeMouvement === 'AJUSTEMENT' ? 'Nouvelle quantité en stock *' : 'Quantité *'}
            type="number"
            min={0}
            step={0.01}
            value={movementForm.quantite || ''}
            onChange={(e) => setMovementForm({ ...movementForm, quantite: parseFloat(e.target.value) || 0 })}
            placeholder={movementForm.typeMouvement === 'AJUSTEMENT' ? 'Quantite reelle en stock' : 'Quantite a entrer/sortir'}
          />
          <Input
            label="Référence"
            value={movementForm.reference}
            onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })}
            placeholder="Ex: BC-2026-001, Projet Heritage, Facture #123"
          />
          <Input
            label="Motif"
            value={movementForm.motif}
            onChange={(e) => setMovementForm({ ...movementForm, motif: e.target.value })}
            placeholder="Ex: Reception commande fournisseur, Envoi chantier St-Hubert"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateMovement(false)}>Annuler</Button>
            <Button
              onClick={handleCreateMovement}
              disabled={!movementForm.produitId || (movementForm.typeMouvement !== 'AJUSTEMENT' && movementForm.quantite <= 0) || (movementForm.typeMouvement === 'AJUSTEMENT' && movementForm.quantite < 0) || movementLoading}
            >
              {movementLoading ? <Spinner size="sm" /> : (
                <>
                  {movementForm.typeMouvement === 'ENTREE' && 'Enregistrer entrée'}
                  {movementForm.typeMouvement === 'SORTIE' && 'Enregistrer sortie'}
                  {movementForm.typeMouvement === 'AJUSTEMENT' && 'Ajuster le stock'}
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create / Edit Product Modal — meme formulaire pour les 2 modes */}
      <Modal
        isOpen={showCreateProduct}
        onClose={() => { setShowCreateProduct(false); resetProductForm(); }}
        title={editingProductId !== null ? "Modifier l'Article" : 'Ajouter un Nouvel Article'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Nom de l'article *"
              placeholder="Ex: Beton 30 MPa, 2x4 8 pieds"
              value={newProduct.nom}
              onChange={(e) => setNewProduct({ ...newProduct, nom: e.target.value })}
              required
            />
            {editingProductId !== null ? (
              <div>
                <Input
                  label="Quantite actuelle"
                  type="number"
                  value={newProduct.stockDisponible || ''}
                  disabled
                  readOnly
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Pour modifier le stock, creez un mouvement (onglet Mouvements) avec le motif AJUSTEMENT.
                </p>
              </div>
            ) : (
              <Input
                label="Quantité initiale"
                type="number"
                value={newProduct.stockDisponible || ''}
                onChange={(e) => setNewProduct({ ...newProduct, stockDisponible: parseFloat(e.target.value) || 0 })}
              />
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Code interne"
              placeholder="Auto-généré si vide"
              value={newProduct.codeProduit}
              onChange={(e) => setNewProduct({ ...newProduct, codeProduit: e.target.value })}
            />
            <Input
              label="Limite minimale"
              type="number"
              value={newProduct.stockMinimum || ''}
              onChange={(e) => setNewProduct({ ...newProduct, stockMinimum: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Type de produit"
              options={TYPE_PRODUIT_OPTIONS}
              value={newProduct.categorie}
              onChange={(e) => setNewProduct({ ...newProduct, categorie: e.target.value })}
            />
            <Input
              label="Unite de vente"
              placeholder="unite, m2, pi, kg, litre..."
              value={newProduct.uniteVente}
              onChange={(e) => setNewProduct({ ...newProduct, uniteVente: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Fournisseur principal"
              placeholder="Ex: Beton Provincial"
              value={newProduct.fournisseurPrincipal}
              onChange={(e) => setNewProduct({ ...newProduct, fournisseurPrincipal: e.target.value })}
            />
            <Input
              label="Emplacement stock"
              placeholder="Ex: Entrepot A, Tablette 3"
              value={newProduct.emplacementStock}
              onChange={(e) => setNewProduct({ ...newProduct, emplacementStock: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Prix unitaire ($)"
              type="number"
              value={newProduct.prixUnitaire || ''}
              onChange={(e) => setNewProduct({ ...newProduct, prixUnitaire: parseFloat(e.target.value) || 0 })}
            />
            <Input
              label="Coût de revient ($)"
              type="number"
              value={newProduct.coutRevient || ''}
              onChange={(e) => setNewProduct({ ...newProduct, coutRevient: parseFloat(e.target.value) || 0 })}
            />
          </div>

          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 pt-1">Normes et certifications</h4>
          <Select
            label="Norme applicable"
            options={NORME_OPTIONS}
            value={newProduct.materiau}
            onChange={(e) => setNewProduct({ ...newProduct, materiau: e.target.value })}
          />

          <Textarea
            label="Description"
            placeholder="Description détaillée du matériau, dimensions, propriétés..."
            value={newProduct.description}
            onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })}
            rows={3}
          />
          <Textarea
            label="Notes"
            placeholder="Notes internes, conditions de stockage, precautions..."
            value={newProduct.notesTechniques}
            onChange={(e) => setNewProduct({ ...newProduct, notesTechniques: e.target.value })}
            rows={3}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => { setShowCreateProduct(false); resetProductForm(); }}>Annuler</Button>
            <Button onClick={handleSaveProduct} disabled={!newProduct.nom.trim() || productSaving}>
              {productSaving
                ? (editingProductId !== null ? 'Mise a jour...' : 'Ajout...')
                : (editingProductId !== null ? "Mettre a jour l'Article" : "Ajouter l'Article")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Supplier Modal (double-click) */}
      <Modal isOpen={!!editSupplier} onClose={() => setEditSupplier(null)} title={`Modifier: ${editSupplier?.nom || ''}`} size="lg">
        {editSupplier && (
          <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
            <Input label="Nom" value={editSupplierForm.nomFournisseur || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, nomFournisseur: e.target.value })} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="Catégorie de Produits"
                options={CATEGORIE_PRODUITS_OPTIONS}
                value={editSupplierForm.categorieProduits || ''}
                onChange={(e) => setEditSupplierForm({ ...editSupplierForm, categorieProduits: e.target.value })}
              />
              <Input label="Conditions de Paiement" value={editSupplierForm.conditionsPaiement || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, conditionsPaiement: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Contact Commercial" value={editSupplierForm.contactCommercial || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, contactCommercial: e.target.value })} />
              <Input label="Contact Technique" value={editSupplierForm.contactTechnique || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, contactTechnique: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Délai Livraison (jours)" type="number" value={editSupplierForm.delaiLivraisonMoyen ?? ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, delaiLivraisonMoyen: parseInt(e.target.value) || 0 })} />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Evaluation Qualite: {editSupplierForm.evaluationQualite ?? 5}/10
                </label>
                <input type="range" min={1} max={10} value={editSupplierForm.evaluationQualite ?? 5} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, evaluationQualite: parseInt(e.target.value) })} className="w-full accent-seaop-primary-600" />
              </div>
            </div>
            <Textarea label="Notes" value={editSupplierForm.notes || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, notes: e.target.value })} rows={2} />
            <Textarea label="Notes d'Évaluation" value={editSupplierForm.notesEvaluation || ''} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, notesEvaluation: e.target.value })} rows={2} />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={editSupplierForm.estActif ?? true} onChange={(e) => setEditSupplierForm({ ...editSupplierForm, estActif: e.target.checked })} className="rounded" />
                Fournisseur actif
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setEditSupplier(null)}>Annuler</Button>
              <Button onClick={handleSaveSupplier} isLoading={editSupplierSaving}>Sauvegarder</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Supplier Modal */}
      <Modal isOpen={showCreateSupplier} onClose={() => setShowCreateSupplier(false)} title="Nouveau Fournisseur" size="lg">
        <div className="space-y-4">
          <Select
            label="Entreprise *"
            options={[
              { value: '0', label: 'Sélectionner une entreprise' },
              ...companiesList.map((c) => ({ value: String(c.id), label: c.nom })),
            ]}
            value={String(supplierForm.companyId || 0)}
            onChange={(e) => setSupplierForm({ ...supplierForm, companyId: parseInt(e.target.value) || 0 })}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Code Fournisseur"
              placeholder="FOUR-2026-001"
              value={supplierForm.codeFournisseur || ''}
              onChange={(e) => setSupplierForm({ ...supplierForm, codeFournisseur: e.target.value })}
            />
            <Input
              label="Conditions de Paiement"
              value={supplierForm.conditionsPaiement || '30 jours net'}
              onChange={(e) => setSupplierForm({ ...supplierForm, conditionsPaiement: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Catégorie de Produits"
              options={CATEGORIE_PRODUITS_OPTIONS}
              value={supplierForm.categorieProduits || ''}
              onChange={(e) => setSupplierForm({ ...supplierForm, categorieProduits: e.target.value })}
            />
            <Input
              label="Contact Commercial"
              value={supplierForm.contactCommercial || ''}
              onChange={(e) => setSupplierForm({ ...supplierForm, contactCommercial: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Délai de Livraison (jours)"
              type="number"
              value={supplierForm.delaiLivraisonMoyen ?? 14}
              onChange={(e) => setSupplierForm({ ...supplierForm, delaiLivraisonMoyen: parseInt(e.target.value) || 0 })}
            />
            <Input
              label="Contact Technique"
              value={supplierForm.contactTechnique || ''}
              onChange={(e) => setSupplierForm({ ...supplierForm, contactTechnique: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Evaluation Qualite: {supplierForm.evaluationQualite ?? 5}/10
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={supplierForm.evaluationQualite ?? 5}
              onChange={(e) => setSupplierForm({ ...supplierForm, evaluationQualite: parseInt(e.target.value) })}
              className="w-full accent-seaop-primary-600"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Certifications Construction
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {CERTIFICATIONS.map((cert) => (
                <label key={cert} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={supplierCerts.includes(cert)}
                    onChange={() => toggleCert(cert)}
                    className="rounded border-gray-300 text-seaop-primary-600 focus:ring-seaop-primary-500"
                  />
                  {cert}
                </label>
              ))}
            </div>
          </div>

          <Textarea
            label="Notes d'Évaluation"
            value={supplierForm.notesEvaluation || ''}
            onChange={(e) => setSupplierForm({ ...supplierForm, notesEvaluation: e.target.value })}
            rows={3}
          />

          <p className="text-xs text-gray-400">* Champs obligatoires</p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowCreateSupplier(false)}>Annuler</Button>
            <Button onClick={handleCreateSupplier} isLoading={supplierLoading} disabled={!supplierForm.companyId}>
              Créer Fournisseur
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create BC Modal */}
      <Modal isOpen={showCreateBC} onClose={() => setShowCreateBC(false)} title="Créer un nouveau bon de commande" size="xl">
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
          {bcError && <Alert type="error" onClose={() => setBcError(null)}>{bcError}</Alert>}

          {/* Fournisseur + Projet */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Fournisseur</h4>
              <Select
                label="Sélectionner un fournisseur *"
                options={[
                  { value: '', label: 'Sélectionner un fournisseur' },
                  ...suppliers.map((s) => ({ value: String(s.id), label: s.nom })),
                ]}
                value={bcForm.supplierId}
                onChange={(e) => setBcForm({ ...bcForm, supplierId: e.target.value })}
              />
            </div>
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Projet</h4>
              <Select
                label="Projet (optionnel)"
                options={[
                  { value: '', label: 'Aucun projet' },
                  ...projectsList.map((p) => ({ value: String(p.id), label: p.nomProjet || `Projet #${p.id}` })),
                ]}
                value={bcForm.projectId}
                onChange={(e) => setBcForm({ ...bcForm, projectId: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Date de livraison prévue"
              type="date"
              value={bcForm.dateLivraisonPrevue}
              onChange={(e) => setBcForm({ ...bcForm, dateLivraisonPrevue: e.target.value })}
            />
            <Input
              label="Notes"
              value={bcForm.notes}
              onChange={(e) => setBcForm({ ...bcForm, notes: e.target.value })}
            />
          </div>

          {/* Articles section */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Articles</h4>

            {bcFormLines.map((line, idx) => (
              <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg">
                {/* Desktop: 12-col grid */}
                <div className="hidden md:grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Select
                      label="Produit"
                      options={[
                        { value: '', label: 'Saisie manuelle...' },
                        ...productsList.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''}` })),
                      ]}
                      value={line.produitId}
                      onChange={(e) => selectProductForBcLine(idx, e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input label="Qte" type="number" value={line.quantite} onChange={(e) => updateBcFormLine(idx, 'quantite', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-2">
                    <Input label="Prix unit. $" type="number" value={line.prixUnitaire || ''} onChange={(e) => updateBcFormLine(idx, 'prixUnitaire', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="col-span-2 text-right">
                    <p className="text-xs text-gray-400 mb-1">Montant</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(line.quantite * line.prixUnitaire)}</p>
                  </div>
                  <div className="col-span-1 text-center">
                    <button onClick={() => removeBcFormLine(idx)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
                {/* Mobile: stacked layout */}
                <div className="md:hidden space-y-2">
                  <Select
                    label="Produit"
                    options={[
                      { value: '', label: 'Saisie manuelle...' },
                      ...productsList.map((p) => ({ value: String(p.id), label: `${p.nom}${p.codeProduit ? ` (${p.codeProduit})` : ''}` })),
                    ]}
                    value={line.produitId}
                    onChange={(e) => selectProductForBcLine(idx, e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input label="Qte" type="number" value={line.quantite} onChange={(e) => updateBcFormLine(idx, 'quantite', parseFloat(e.target.value) || 0)} />
                    <Input label="Prix unit. $" type="number" value={line.prixUnitaire || ''} onChange={(e) => updateBcFormLine(idx, 'prixUnitaire', parseFloat(e.target.value) || 0)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(line.quantite * line.prixUnitaire)}</p>
                    <button onClick={() => removeBcFormLine(idx)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
                {!line.produitId && (
                  <div className="mt-2">
                    <Input label="Description" placeholder="Description de l'article" value={line.description} onChange={(e) => updateBcFormLine(idx, 'description', e.target.value)} />
                  </div>
                )}
              </div>
            ))}

            <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={addBcFormLine}>
              Ajouter un article
            </Button>

            {bcFormLines.length > 0 && (
              <div className="mt-3 text-right">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Total: {formatCurrency(bcFormTotal)}
                </span>
              </div>
            )}

            {bcFormLines.length === 0 && (
              <p className="text-xs text-gray-400 mt-2">Aucun article ajoute. Utilisez le bouton ci-dessus pour ajouter des articles.</p>
            )}
          </div>

          <div className="flex justify-center pt-2">
            <Button onClick={handleCreateBC} isLoading={bcLoading} disabled={!bcForm.supplierId} className="px-12">
              Créer le bon de commande
            </Button>
          </div>
        </div>
      </Modal>

      {/* BC HTML Preview Modal */}
      <Modal
        isOpen={showBcHtmlPreview}
        onClose={() => { setShowBcHtmlPreview(false); setBcHtmlContent(''); }}
        title={`Aperçu du bon de commande ${selectedBC?.numero || ''}`}
        size="xl"
      >
        <div className="space-y-4">
          {bcHtmlContent ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[calc(100vh-200px)] md:h-[70vh]">
              <iframe
                srcDoc={bcHtmlContent}
                title="Aperçu bon de commande"
                className="w-full h-full bg-white"
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                const win = window.open('', '_blank');
                if (win) {
                  win.document.write(bcHtmlContent);
                  win.document.close();
                }
              }}
              disabled={!bcHtmlContent}
            >
              Ouvrir dans un nouvel onglet
            </Button>
            <Button variant="ghost" onClick={() => { setShowBcHtmlPreview(false); setBcHtmlContent(''); }}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
