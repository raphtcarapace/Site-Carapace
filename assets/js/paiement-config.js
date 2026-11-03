// =====================================================================
//  Paiement en ligne — PayPal Checkout (SDK JavaScript, côté navigateur)
//
//  PAYPAL_CLIENT_ID est un identifiant PUBLIC (il est visible dans le
//  navigateur). Laissez-le vide tant que le compte PayPal n'est pas prêt :
//  le site n'affiche alors que « Être rappelé ».
//
//  IMPORTANT — aucun serveur ne confirme le montant :
//  avant d'expédier ou d'installer, l'admin doit vérifier dans son compte
//  PayPal que le paiement est bien reçu. Un « onApprove » dans le navigateur
//  du client ne garantit pas, à lui seul, que l'argent est encaissé.
// =====================================================================
export const PAIEMENT = {
    PAYPAL_CLIENT_ID: '',
    CURRENCY: 'EUR'
};
