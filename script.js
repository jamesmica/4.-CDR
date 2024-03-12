const apiKey = 'AIzaSyC2YFqXtmJh4c4jYPwGvPmWnU1iEhGWj0E';
const sheetId = '1FUhix1FToy_joK8lZuiZvZp6aCeQncByDaFVfPGKU1k';
const range = 'Feuille 1!A1:I1224';
const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
const urlCSV = 'centroides_total.csv';
var dataCSV; 
var tousLesMarqueurs = []; // Ce tableau va stocker tous les marqueurs




var map = L.map('map').setView([46.71109, 1.7191036], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

function chargerCSV(urlCSV) {
    return fetch(urlCSV)
        .then(response => response.text())
        .then(csvText => {
            return new Promise(resolve => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function(results) {
                        const data = results.data.map(row => ({
                            INSEE: row['INSEE'].toString().trim(),
                            lat: parseFloat(row['lat']),
                            lon: parseFloat(row['lon'])
                        })).filter(item => !isNaN(item.lat) && !isNaN(item.lon));
                        resolve(data);
                    }
                });
            });
        });
}

function filterMapByType(selectedType) {
    // Efface tous les marqueurs actuellement présents sur la carte
    map.eachLayer(function(layer) {
        if (layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });

    // Filtrer les données Google Sheets selon le type sélectionné
    const filteredRows = rowsGSheet.filter(row => row[indices.indexType] === selectedType || selectedType === "Tous");

    // Effacer le contenu actuel de l'élément qui affiche le tableau
    document.getElementById('info').innerHTML = '';

    // Construire le nouveau contenu HTML pour le tableau basé sur les données filtrées
    let htmlContent = `<h4>Résultats filtrés:</h4><table><tr><th>Entreprise</th><th>Type</th><th>Date</th></tr>`;
    filteredRows.forEach(row => {
        const associatedCompany = row[indices.indexAssociatedCompany];
        const nomType = row[indices.indexNomType];
        const date = row[indices.indexDate];
        htmlContent += `<tr><td>${associatedCompany}</td><td>${nomType}</td><td>${date}</td></tr>`;
    });
    htmlContent += `</table>`;

    // Mettre à jour l'élément HTML avec le nouveau contenu du tableau
    document.getElementById('info').innerHTML = htmlContent;


    // Itérer sur les données filtrées et ajouter les marqueurs à la carte
    filteredRows.forEach(rowGSheet => {
        const codeInseeGSheet = rowGSheet[indices.indexCodeInsee].toString().trim();
        const correspondance = dataCSV.find(rowCSV => rowCSV.INSEE === codeInseeGSheet);
        if (correspondance) {
            const associatedCompany = rowGSheet[indices.indexAssociatedCompany];
            const nomType = rowGSheet[indices.indexNomType];
            const date = rowGSheet[indices.indexDate];
            const couleur = rowGSheet[indices.indexCOL];
            
            L.circleMarker([correspondance.lat, correspondance.lon], {
                color: couleur || 'grey', 
                fillColor: couleur || 'grey',
                fillOpacity: 1,
                radius: 5
            }).addTo(map)
            .bindTooltip(`<strong>${associatedCompany}</strong><br>${nomType}<br>${date}`, { 
                permanent: false, 
                direction: 'auto'
            });
        }
    });
}




var rowsGSheet; // Déclarer au niveau le plus élevé pour une portée globale
var indices; // Déclarer au niveau le plus élevé pour une portée globale

document.addEventListener("DOMContentLoaded", () => {
    // Traitement des données Google Sheets et CSV
    fetch(url)
      .then(response => response.json())
      .then(data => {
          const header = data.values[0];
          rowsGSheet = data.values.slice(1);
          // Obtention des indices des colonnes nécessaires
          indices = {
              indexAssociatedCompany: header.indexOf('Associated Company'),
              indexNomType: header.indexOf('NomType'),
              indexType: header.indexOf('Type'),
              indexDate: header.indexOf('Date'),
              indexCOL: header.indexOf('COL'),
              indexCodeInsee: header.indexOf('INSEE'),
              indexRegion: header.indexOf('Region') 
          };
          const types = new Set(data.values.slice(1).map(row => row[indices.indexType]));
            const typeFilter = document.getElementById('typeFilter');
            types.forEach(type => {
                if (type) { // Assurez-vous que le type n'est pas vide ou undefined
                    typeFilter.innerHTML += `<option value="${type}">${type}</option>`;
                }
            });
    
          // Charger le fichier CSV une seule fois ici
          return chargerCSV(urlCSV).then(dataCSVResult => {
              dataCSV = dataCSVResult;
              return { dataCSV, rowsGSheet, indices };
          });
      })
      .then(({ dataCSV, rowsGSheet, indices }) => {
          // Utilisation des données pour créer les marqueurs sur la carte
          rowsGSheet.forEach(rowGSheet => {
              const codeInseeGSheet = rowGSheet[indices.indexCodeInsee].toString().trim();
              const correspondance = dataCSV.find(rowCSV => rowCSV.INSEE === codeInseeGSheet);
              if (correspondance) {
                  const associatedCompany = rowGSheet[indices.indexAssociatedCompany];
                  const nomType = rowGSheet[indices.indexNomType];
                  const date = rowGSheet[indices.indexDate];
                  const couleur = rowGSheet[indices.indexCOL];
    
                  L.circleMarker([correspondance.lat, correspondance.lon], {
                    color: couleur || 'grey', 
                    fillColor: couleur || 'grey',
                    fillOpacity: 1,
                    radius: 5
                  }).addTo(map)
                  .bindTooltip(`<strong>${associatedCompany}</strong><br>${nomType}<br>${date}`, { 
                      permanent: false, 
                      direction: 'auto'
                  });
              }
          });
      })
      .catch(error => console.error('Erreur lors de la récupération des données :', error));
    
      fetch('./regions-20180101.json')
      .then(response => response.json())
      .then(data => {
          var geojsonLayer = L.geoJSON(data, {
              style: function(feature) {
                  return {
                      color: "#00753B", // Couleur des contours
                      weight: 1, // Épaisseur des contours initiale
                      fillColor: "grey", // Couleur de remplissage
                      fillOpacity: 0.01 // Presque transparent
                  };
              },
              onEachFeature: function(feature, layer) {
                  layer.on('click', function(e) {
                      // Trouver les points correspondant au nom de la région cliquée
                      var nomRegion = feature.properties.nom;
                    //   console.log('nomregion :',nomRegion);
                      var pointsDansRegion = rowsGSheet.filter(row => row[indices.indexRegion] === nomRegion);
                    //   console.log('points :',pointsDansRegion);

                      document.getElementById('nombreElements').innerHTML = `${nomRegion} : ${pointsDansRegion.length} références`;
                      
                      // Construire le tableau HTML avec les informations des points
                      var html = `<h4>Points dans ${nomRegion}:</h4><table><tr><th>Entreprise</th><th>Type</th><th>Date</th></tr>`;
                      pointsDansRegion.forEach(point => {
                          html += `<tr><td>${point[indices.indexAssociatedCompany]}</td><td>${point[indices.indexNomType]}</td><td>${point[indices.indexDate]}</td></tr>`;
                      });
                      html += `</table>`;
                      
                      // Afficher le tableau dans l'élément div#info
                      document.getElementById('info').innerHTML = html;
                  });
                  layer.on({
                      mouseover: function(e) {
                          e.target.setStyle({
                              weight: 3, // Augmente la largeur lors du survol
                              fillColor: '#00753B',
                              color: '#00753B',
                              fillOpacity: 0.01 // Rend le remplissage légèrement plus visible lors du survol
                          });
                      },
                      mouseout: function(e) {
                          geojsonLayer.resetStyle(e.target); // Réinitialise le style après le survol
                      }
                  });
    
                  // Ajoutez ici vos gestionnaires mouseover et mouseout si nécessaire
              }
          }).addTo(map);
      });

      document.getElementById('typeFilter').addEventListener('change', function() {
        filterMapByType(this.value); // Appelle une fonction pour filtrer la carte
    });
    

});








 

// function afficherDonneesGSheetSurPage(rowsGSheet) {
//     let htmlContent = "<h3>Données Google Sheet</h3><ul>";
//     rowsGSheet.forEach(row => {
//         htmlContent += `<li>${row.join(", ")}</li>`;
//     });
//     htmlContent += "</ul>";
//     document.getElementById('donneesGSheet').innerHTML = htmlContent;
// }

// function afficherDonneesCSVSurPage(dataCSV) {
//     let htmlContent = "<h3>Données CSV</h3><ul>";
//     dataCSV.forEach(item => {
//         htmlContent += `<li>Code INSEE : ${item.INSEE}, Latitude : ${item.lat}, Longitude : ${item.lon}</li>`;
//     });
//     htmlContent += "</ul>";
//     document.getElementById('donneesCSV').innerHTML = htmlContent;
// }
