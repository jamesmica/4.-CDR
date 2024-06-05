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

var selectedRegion = null; // Région sélectionnée, null si aucune
var selectedType = []; // Initialisation comme un tableau vide
let filteredRows; // Ceci est une variable globale maintenant.
let currentIndex = 0; // Vous devez initialiser ceci si vous ne l'avez pas déjà fait ailleurs.
let batchSize = 20; // Vous devez initialiser ceci si vous ne l'avez pas déjà fait ailleurs.

document.addEventListener("DOMContentLoaded", () => {
    var infoDiv = document.getElementById('typeFilterContainer');
    infoDiv.style.width = "0px";
    toggleInfoBtn.classList.replace('btn-arrow', 'btn-cross');

    document.getElementById('toggleInfoBtn').addEventListener('click', function() {
        
        
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
                        typeFilter.innerHTML += `<option value="${type}" selected>${type}</option>`;
                        selectedType.push(type); // Ajouter chaque type à la liste des types sélectionnés
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
            selectedType = Array.from(this.selectedOptions).map(option => option.value);
            console.log('Updated Selected Types:', selectedType); // Ceci devrait afficher les types sélectionnés
            applyFilters();
        });

        document.querySelectorAll('#typeFilterDisplay span').forEach(function(span) {
            span.addEventListener('click', function() {
                // Toggle la classe 'selected' sur les spans
                this.classList.toggle('selected');
        
                // Récupérer tous les spans sélectionnés
                var selectedSpans = document.querySelectorAll('#typeFilterDisplay span.selected');
                var selectedValues = Array.from(selectedSpans).map(span => span.getAttribute('data-value'));
        
                console.log("Selected Types: ", selectedValues); // Debugging
        
                // Obtenir la référence au <select> caché
                const selectElement = document.getElementById('typeFilter');
        
                // Mettre à jour les options du <select> pour refléter la sélection des spans
                Array.from(selectElement.options).forEach(option => {
                    option.selected = selectedValues.includes(option.value);
                });
        
                // Déclencher l'événement 'change' sur le <select> pour appliquer les filtres
                selectElement.dispatchEvent(new Event('change'));
            });
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
                                weight: 3,
                                fillOpacity: 0
                            });
                            previousSelectedLayer = layer;
                            
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

    document.querySelectorAll('.animated-underline:not(.selected)').forEach(link => {
        link.addEventListener('mouseover', () => {
            link.classList.add('hover');
        });
    
        link.addEventListener('mouseout', () => {
            // Ajoute temporairement une classe pour gérer l'animation de sortie.
            link.classList.remove('hover');
            link.classList.add('hover-out');
    
            setTimeout(() => {
                link.classList.remove('hover-out');
            }, 300); // Assurez-vous que ce délai correspond à la durée de votre animation CSS.
        });
    });
});

function loadBatch() {
    let infoTable = document.getElementById('info-table'); // Assurez-vous que c'est l'id de votre tableau
    for (let i = currentIndex; i < Math.min(filteredRows.length, currentIndex + batchSize); i++) {
        const row = filteredRows[i];
        const associatedCompany = row[indices.indexAssociatedCompany];
        const nomType = row[indices.indexNomType];
        const date = row[indices.indexDate];
        let rowHTML = `<tr><td>${associatedCompany}</td><td>${nomType}</td><td>${date}</td></tr>`;
        infoTable.innerHTML += rowHTML;
    }
    currentIndex += batchSize; // Mettre à jour l'index pour le prochain lot
}

function applyFilters() {
    // Clear all current markers on the map
    map.eachLayer(function(layer) {
        if (layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });

    let pointsGroupedByLocation = {};
    console.log(selectedType);
    
    filteredRows = rowsGSheet.filter(row => {
        const matchesType = selectedType.includes("Tous") || (Array.isArray(selectedType) && selectedType.some(type => type === row[indices.indexType]));
        const matchesRegion = !selectedRegion || row[indices.indexRegion] === selectedRegion;
        return matchesType && matchesRegion;
    });

    console.log('filteredRows : ', filteredRows);

    let infoHTML = `<table id="info-table"><tr><th>Territoire</th><th>Type</th><th>Date</th></tr>`;

    filteredRows.forEach(row => {
        if (row && indices.indexAssociatedCompany !== undefined && indices.indexNomType !== undefined && indices.indexDate !== undefined) {
            const associatedCompany = row[indices.indexAssociatedCompany];
            const nomType = row[indices.indexNomType];
            const date = row[indices.indexDate];
            infoHTML += `<tr><td>${associatedCompany}</td><td>${nomType}</td><td>${date}</td></tr>`;
        } else {
            console.error('Undefined row or index:', row, indices);
        }
    });
    infoHTML += `</table>`;

    document.getElementById('nombreRefs').innerHTML = `${rowsGSheet.length} références`;

    if (selectedRegion && selectedType.length > 0) {
        document.getElementById('nombreElements').innerHTML = `${selectedRegion} > ${selectedType.join(', ')}`;
    } else if (selectedType.length === 0 && !selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `France`;
    } else if (selectedType.length === 0 && selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `${selectedRegion}`;
    } else if (selectedType.length > 0 && !selectedRegion) {
        document.getElementById('nombreElements').innerHTML = `France > ${selectedType.join(', ')}`;
    }

    document.getElementById('nombreRef').innerHTML = `${filteredRows.length} résultats`;

    document.getElementById('info').innerHTML = infoHTML;
    document.getElementById('info').style.height = "calc(-328px + 100vh)";

    const filteredRowsByType = rowsGSheet.filter(row => 
        selectedType.includes("Tous") || selectedType.includes(row[indices.indexType])
    );

    console.log(filteredRowsByType);

    filteredRowsByType.forEach(row => {
        const codeInsee = row[indices.indexCodeInsee].toString().trim();
        const correspondance = dataCSV.find(rowCSV => rowCSV.INSEE === codeInsee);
        if (correspondance) {
            const key = `${correspondance.lat},${correspondance.lon}`;
            if (!pointsGroupedByLocation[key]) {
                pointsGroupedByLocation[key] = {
                    data: [],
                    color: row[indices.indexCOL] || 'grey',
                };
            }
            pointsGroupedByLocation[key].data.push(row);
        }
    });

    Object.keys(pointsGroupedByLocation).forEach((key) => {
        const groupData = pointsGroupedByLocation[key].data;
        const [lat, lon] = key.split(',');
        const groupColor = pointsGroupedByLocation[key].color;

        let tooltipContent = groupData.map(point => {
            return `<strong>${point[indices.indexAssociatedCompany]}</strong><br>${point[indices.indexNomType]}<br>${point[indices.indexDate]}`;
        }).join('<hr>');

        let opacity = 0.5;
        let opacityBorder = 0.5;
        groupData.forEach(point => {
            const isInSelectedRegion = !selectedRegion || point[indices.indexRegion] === selectedRegion;
            if (isInSelectedRegion) {
                opacity = 1;
                opacityBorder = 1;
            }
        });

        L.circleMarker([lat, lon], {
            color: groupColor,
            fillColor: groupColor,
            fillOpacity: opacity,
            opacity: opacityBorder,
            radius: 5
        }).addTo(map).bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'auto'
        });
    });
}

function resetRegionFilter() {
    selectedRegion = null; // Réinitialise la sélection de la région
    selectedType = []; // Réinitialise la sélection du type à "Tous"

    document.querySelectorAll('.selected').forEach(link => {
        link.classList.remove('selected');
        link.classList.add('hover-out');
      
        setTimeout(() => {
            link.classList.remove('hover-out');
        }, 300); // Assurez-vous que ce délai correspond à la durée de votre animation CSS.
    });

    document.getElementById('typeFilter').value = "Tous"; // Réinitialise la sélection
    applyFilters(); 

    // Réinitialise la vue de la carte à la position et au zoom par défaut
    map.setView([46.71109, 1.7191036], 6);
}
