const apiKey = 'AIzaSyC2YFqXtmJh4c4jYPwGvPmWnU1iEhGWj0E';
const sheetId = '1FUhix1FToy_joK8lZuiZvZp6aCeQncByDaFVfPGKU1k';
const range = 'Feuille 1!A1:J1500';
const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`;
const urlCSV = 'centroides_total.csv';
var previousSelectedLayer = null; // Conserve une référence à la dernière région sélectionnée
var geojsonLayer; 
var correspondance;

var map = L.map('map').setView([46.71109, 1.7191036], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

var rowsGSheet; // Données Google Sheets
var indices; // Indices des colonnes nécessaires
var dataCSV; // Données du fichier CSV
var selectedType = "Tous"; // Type sélectionné, "Tous" par défaut
var selectedRegion = null; // Région sélectionnée, null si aucune


document.addEventListener("DOMContentLoaded", () => {


    document.getElementById('toggleInfoBtn').addEventListener('click', function() {
        var infoDiv = document.getElementById('typeFilterContainer');
        
        if (infoDiv.style.width !== "0px") {
            requestAnimationFrame(() => {
                infoDiv.style.width = "0px";
            });
            toggleInfoBtn.classList.replace('btn-arrow', 'btn-cross');
        } else {
            requestAnimationFrame(() => {
                infoDiv.style.width = "360px";
            });
            toggleInfoBtn.classList.replace('btn-cross', 'btn-arrow');
        }
    });
    
    document.getElementById('toggleInfoBtn').classList.add('btn-arrow');
    
    
    init(); // Initialisation et chargement des données

});

map.on("click", function (event) {

    var clickedLayers = leafletPip.pointInLayer(event.latlng, geojsonLayer, true);

    if (clickedLayers.length > 0) {
        var firstLayer = clickedLayers[0]; // Prendre la première couche trouvée
        
        if (firstLayer && firstLayer.feature && firstLayer.fire) {
            firstLayer.fire('click', {
                latlng: event.latlng,
                layer: firstLayer
            });

        }
    } else {
        console.log("Aucune couche trouvée sous le point cliqué.");
    }
});

function init() {
    fetch(url)
        .then(response => response.json())
        .then(data => {
            const header = data.values[0];
            rowsGSheet = data.values.slice(1);
            indices = {
                indexAssociatedCompany: header.indexOf('Associated Company'),
                indexNomType: header.indexOf('NomType'),
                indexType: header.indexOf('Type'),
                indexDate: header.indexOf('Date'),
                indexCOL: header.indexOf('COL'),
                indexCodeInsee: header.indexOf('INSEE'),
                indexRegion: header.indexOf('Region') 
            };

            rowsGSheet.sort((a, b) => Number(b[indices.indexDate]) - Number(a[indices.indexDate]));

            const typeFilter = document.getElementById('typeFilter');
            const types = new Set(data.values.slice(1).map(row => row[indices.indexType]));
            types.forEach(type => {
                if (type) {
                    typeFilter.innerHTML += `<option value="${type}">${type}</option>`;
                }
            });

            return chargerCSV(urlCSV);
        })
        .then(dataCSVResult => {
            dataCSV = dataCSVResult;
            applyFilters();
        })
        .catch(error => console.error('Erreur lors de la récupération des données :', error));

    document.getElementById('typeFilter').addEventListener('change', function() {
        selectedType = this.value;
        applyFilters();
    });

fetch('./regions-20180101.json')
.then(response => response.json())
.then(data => {
    geojsonLayer = L.geoJSON(data, {
        style: function(feature) {
            return {
                color: "#00753B", 
                weight: 1, 
                fillColor: "grey", 
                fillOpacity: 0
            };
        },
        onEachFeature: function(feature, layer) {
            layer.on('click', function(e) {
                selectedRegion = feature.properties.nom;
                if (previousSelectedLayer) {
                    // Réinitialise le style de la région précédemment sélectionnée
                    geojsonLayer.resetStyle(previousSelectedLayer);
                }
                // Change l'épaisseur de la ligne de la région sélectionnée
                layer.setStyle({
                    weight: 3, // Augmente l'épaisseur du contour pour la région sélectionnée
                    fillOpacity: 0 // Vous pouvez également ajuster d'autres propriétés visuelles ici
                });
                previousSelectedLayer = layer; // Met à jour la référence à la couche sélectionnée
                
                applyFilters();
            });
            layer.on({
                mouseover: function(e) {
                    e.target.setStyle({
                        weight: 3,
                        fillColor: '#00753B',
                        color: '#00753B',
                        fillOpacity: 0.01
                    });
                },
                mouseout: function(e) {
                    if (e.target != previousSelectedLayer) {
                        // Réinitialise le style seulement si la couche n'est pas celle sélectionnée
                        geojsonLayer.resetStyle(e.target);
                    }
                }
            });
        }
    }).addTo(map);
});

}

function chargerCSV(urlCSV) {
    return fetch(urlCSV)
        .then(response => response.text())
        .then(csvText => {
            return new Promise(resolve => {
                Papa.parse(csvText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: function(results) {
                        resolve(results.data.map(row => ({
                            INSEE: row['INSEE'].toString().trim(),
                            lat: parseFloat(row['lat']),
                            lon: parseFloat(row['lon'])
                        })).filter(item => !isNaN(item.lat) && !isNaN(item.lon)));
                    }
                });
            });
        });
}

function resetRegionFilter() {
    selectedRegion = null; // Réinitialise la sélection de la région
    selectedType = "Tous"; // Réinitialise la sélection du type à "Tous"
    
    // Réinitialise le style de la région précédemment sélectionnée, si applicable
    if (previousSelectedLayer) {
        geojsonLayer.resetStyle(previousSelectedLayer);
        previousSelectedLayer = null; // Efface la référence à la couche précédemment sélectionnée
    }

    applyFilters(); // Applique les filtres sans la sélection de région
    
    // Réinitialise la sélection du filtre de type dans l'UI
    document.getElementById('typeFilter').value = "Tous";
    // document.getElementById('info').style.height = "0";
    
    // Réinitialise la vue de la carte à la position et au zoom par défaut
    map.setView([46.71109, 1.7191036], 6);
}




function applyFilters() {
    // Efface tous les marqueurs actuellement présents sur la carte
    map.eachLayer(function(layer) {
        if (layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });


    // Filtrer les données Google Sheets selon les critères sélectionnés
    const filteredRows = rowsGSheet.filter(row => {
        const matchesType = selectedType === "Tous" || row[indices.indexType] === selectedType;
        const matchesRegion = !selectedRegion || row[indices.indexRegion] === selectedRegion;
        return matchesType && matchesRegion;
    });

    if (selectedRegion && selectedType != "Tous") {
        document.getElementById('nombreElements').innerHTML = `${selectedRegion} > ${selectedType}<br> ${filteredRows.length} références`;
    } else if (selectedType === "Tous" && !selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `France<br>${filteredRows.length} références`;
    } else if (selectedType === "Tous" && selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `${selectedRegion}<br> ${filteredRows.length} références`;
    } else if (selectedType !== "Tous" && !selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `France > ${selectedType}<br> ${filteredRows.length} références`;
    }

    document.getElementById('nombreRef').innerHTML = `${filteredRows.length} résultats`


    // Construire le contenu HTML pour le tableau d'informations
    let infoHTML = `<table><tr><th>Territoire</th><th>Type</th><th>Date</th></tr>`;
    filteredRows.forEach(row => {
        const associatedCompany = row[indices.indexAssociatedCompany];
        const nomType = row[indices.indexNomType];
        const date = row[indices.indexDate];
        infoHTML += `<tr><td>${associatedCompany}</td><td>${nomType}</td><td>${date}</td></tr>`;
    });
    infoHTML += `</table>`;

    // Mettre à jour l'élément HTML avec les informations filtrées
    document.getElementById('info').innerHTML = infoHTML;
    document.getElementById('info').style.height = "calc(-255px + 100vh)"

    const filteredRowsByType = rowsGSheet.filter(row => selectedType === "Tous" || row[indices.indexType] === selectedType);

    // Construire et afficher les marqueurs
    filteredRowsByType.forEach(rowGSheet => {
        const codeInseeGSheet = rowGSheet[indices.indexCodeInsee].toString().trim();
        correspondance = dataCSV.find(rowCSV => rowCSV.INSEE === codeInseeGSheet);
        if (correspondance) {
            const isInSelectedRegion = selectedRegion ? rowGSheet[indices.indexRegion] === selectedRegion : true;
            const opacity = isInSelectedRegion ? 1 : 0.5; // Opacité pleine pour les points dans la région sélectionnée, sinon réduite
            const associatedCompany = rowGSheet[indices.indexAssociatedCompany];
            const nomType = rowGSheet[indices.indexNomType];
            const date = rowGSheet[indices.indexDate];
            const couleur = rowGSheet[indices.indexCOL];
            const opacityBorder = isInSelectedRegion ? 1 : 0;

            L.circleMarker([correspondance.lat, correspondance.lon], {
                color: couleur || 'grey',
                fillColor: couleur || 'grey',
                fillOpacity: opacity, // Utilise l'opacité basée sur l'appartenance à la région
                opacity: opacityBorder,
                radius: 5
            }).addTo(map)
            .bindTooltip(`<strong>${associatedCompany}</strong><br>${nomType}<br>${date}`, { 
                permanent: false, 
                direction: 'auto'
            });
        }
    });


}