  // Initialize Lucide icons
  lucide.createIcons();
    
  // Set current year
  $('#current-year').text(new Date().getFullYear());
  
  // Tab Switching
  $('#tab-single').on('click', function() {
      // Styles for active tab
      $(this).removeClass('text-slate-400 border-transparent hover:bg-white/5')
             .addClass('text-amber-400 border-amber-500 bg-white/5');
      
      // Styles for inactive tab
      $('#tab-bulk').removeClass('text-amber-400 border-amber-500 bg-white/5')
                    .addClass('text-slate-400 border-transparent hover:bg-white/5');
      
      // Show/Hide sections
      $('#single-check-section').removeClass('hidden');
      $('#bulk-check-section').addClass('hidden');
  });

  $('#tab-bulk').on('click', function() {
      // Styles for active tab
      $(this).removeClass('text-slate-400 border-transparent hover:bg-white/5')
             .addClass('text-amber-400 border-amber-500 bg-white/5');
      
      // Styles for inactive tab
      $('#tab-single').removeClass('text-amber-400 border-amber-500 bg-white/5')
                    .addClass('text-slate-400 border-transparent hover:bg-white/5');
      
      // Show/Hide sections
      $('#bulk-check-section').removeClass('hidden');
      $('#single-check-section').addClass('hidden');
  });

  // File Input Change
  $('#excelFile').on('change', function() {
      const fileName = this.files[0]?.name;
      if (fileName) {
          $('#file-name-display').text(fileName).addClass('text-amber-400').removeClass('text-slate-300');
          $('#bulk-submit-button').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      } else {
          $('#file-name-display').text('Click or Drag Excel file here').addClass('text-slate-300').removeClass('text-amber-400');
          $('#bulk-submit-button').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      }
  });
  
  // Single Check Form submission
  $('#validation-form').on('submit', function(e) {
    e.preventDefault();
    
    const gameId = $('#gameId').val();
    const serverId = $('#serverId').val();
    
    if (!gameId || !serverId) {
      showError('Please enter User ID and Server ID');
      return;
    }
    
    // Show loading state
    const originalButtonText = $('#submit-button').html();
    $('#submit-button').html('<i data-lucide="loader-2" class="animate-spin w-4 h-4"></i><span>Checking...</span>');
    $('#submit-button').prop('disabled', true);
    lucide.createIcons();
    
    // Hide previous results/errors
    $('#error-container').addClass('hidden');
    $('#result-container').addClass('hidden');
    
    // Make AJAX call to the API
    $.ajax({
      url: '/api/validasi',
      type: 'GET',
      data: {
        id: gameId,
        serverid: serverId
      },
      dataType: 'json',
      success: function(data) {
        if (data.status === 'success') {
          showResult(data.result);
        } else {
          showError(data.message || 'Failed to validate ID');
        }
      },
      error: function(xhr, status, error) {
        let errorMessage = 'Error connecting to server';
        
        try {
          const response = JSON.parse(xhr.responseText);
          if (response && response.message) {
            errorMessage = response.message;
          }
        } catch (e) {
          // If parsing fails, use the default error message
        }
        
        showError(errorMessage);
      },
      complete: function() {
        // Reset button state
        $('#submit-button').html(originalButtonText);
        $('#submit-button').prop('disabled', false);
        lucide.createIcons();
      }
    });
  });

  // Bulk Check Variables
  let isProcessing = false;
  let bulkResults = [];

  // Bulk Check Form submission (Client-Side)
  $('#bulk-form').on('submit', async function(e) {
      e.preventDefault();
      if (isProcessing) return;

      const fileInput = $('#excelFile')[0];
      if (fileInput.files.length === 0) {
          showBulkError('Please upload an Excel file');
          return;
      }

      const file = fileInput.files[0];
      const reader = new FileReader();

      reader.onload = async function(e) {
          try {
              const data = new Uint8Array(e.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              const jsonData = XLSX.utils.sheet_to_json(worksheet);

              // Filter valid rows
              const rowsToCheck = jsonData.filter(row => row['UID'] || row['Server']);

              if (rowsToCheck.length === 0) {
                  showBulkError('No valid data found in Excel (Columns "UID" and "Server" required)');
                  return;
              }

              // UI Updates
              isProcessing = true;
              bulkResults = []; // Reset results
              $('#bulk-submit-button').prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
              $('#bulk-progress-container').removeClass('hidden');
              $('#bulk-error-container').addClass('hidden');
              $('#download-container').addClass('hidden');
              $('#bulk-results-body').empty();
              
              updateProgress(0, 0, rowsToCheck.length);

              // Process rows
              for (let i = 0; i < rowsToCheck.length; i++) {
                  const row = rowsToCheck[i];
                  const uid = row['UID'];
                  const server = row['Server'];
                  let resultRow = { ...row };

                  try {
                      if (uid && server) {
                          // Call API
                          const response = await checkAccount(uid, server);
                          if (response.status === 'success') {
                              resultRow['Players IGN'] = response.result.nickname;
                              resultRow['Status'] = 'Found';
                              // Update UI Table
                              appendBulkRow(i + 1, server, uid, response.result.nickname, 'Found');
                          } else {
                              resultRow['Players IGN'] = 'not found';
                              resultRow['Status'] = 'Not Found';
                              appendBulkRow(i + 1, server, uid, 'not found', 'Not Found');
                          }
                      } else {
                          resultRow['Players IGN'] = 'Invalid Data';
                          resultRow['Status'] = 'Error';
                          appendBulkRow(i + 1, server || '-', uid || '-', 'Invalid Data', 'Error');
                      }
                  } catch (err) {
                      resultRow['Players IGN'] = 'Error';
                      resultRow['Status'] = 'Error';
                      appendBulkRow(i + 1, server, uid, 'Error', 'Error');
                  }

                  bulkResults.push(resultRow);
                  updateProgress(Math.round(((i + 1) / rowsToCheck.length) * 100), i + 1, rowsToCheck.length);
                  
                  // Small delay
                  await new Promise(r => setTimeout(r, 50));
              }

              // Complete
              isProcessing = false;
              $('#progress-status-text').text('Completed!').addClass('text-emerald-400');
              $('#download-container').removeClass('hidden');

              // Setup download button
              $('#download-btn').off('click').on('click', function() {
                  downloadResults(bulkResults);
              });

          } catch (error) {
              console.error(error);
              showBulkError('Error parsing Excel file: ' + error.message);
              resetBulkState();
          }
      };

      reader.readAsArrayBuffer(file);
  });

  function checkAccount(id, server) {
      return new Promise((resolve, reject) => {
          $.ajax({
              url: '/api/validasi',
              type: 'GET',
              data: { id, serverid: server },
              success: function(data) {
                  resolve(data);
              },
              error: function(err) {
                  resolve({ status: 'failed', message: 'Network error' });
              }
          });
      });
  }

  function downloadResults(data) {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Results");
      XLSX.writeFile(wb, "MLBB_Check_Results.xlsx");
  }

  function appendBulkRow(index, server, uid, username, status) {
      const statusClass = status === 'Found' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 
                          status === 'Not Found' ? 'text-red-400 bg-red-500/10 border-red-500/20' : 
                          'text-amber-400 bg-amber-500/10 border-amber-500/20';
      
      const rowHtml = `
          <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td class="text-slate-500 text-xs">${index}</td>
              <td class="text-slate-300 font-mono text-xs">${server}</td>
              <td class="text-slate-300 font-mono text-xs">${uid}</td>
              <td class="text-white font-medium text-sm truncate max-w-[150px]">${username}</td>
              <td>
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${statusClass}">
                      ${status}
                  </span>
              </td>
          </tr>
      `;
      $('#bulk-results-body').append(rowHtml);
  }
  }
  
  function renderBulkTable(rows) {
      const tbody = $('#bulk-results-body');
      tbody.empty();
      
      rows.forEach(row => {
          let statusClass = 'status-error';
          if (row.status === 'Found') {
              statusClass = 'status-success';
          }
          
          const tr = `
            <tr>
              <td>${row.id}</td>
              <td>${row.server}</td>
              <td>${row.uid}</td>
              <td>${row.username}</td>
              <td><span class="status-badge ${statusClass}">${row.status}</span></td>
            </tr>
          `;
          tbody.append(tr);
      });
      
      // Auto scroll to bottom
      const container = $('.glass-table-container');
      container.scrollTop(container[0].scrollHeight);
  }

  function updateProgress(percentage, processed, total) {
      $('#progress-bar-fill').css('width', percentage + '%');
      $('#progress-percentage').text(percentage + '%');
      $('#progress-detail').text(`${processed} / ${total} accounts checked`);
  }

  function resetBulkState() {
      $('#bulk-submit-button').prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $('#bulk-progress-container').addClass('hidden');
      $('#bulk-results-body').empty();
  }
  
  function showError(message) {
    $('#error-message').text(message);
    $('#error-container').removeClass('hidden').addClass('fade-enter');
  }

  function showBulkError(message) {
      $('#bulk-error-message').text(message);
      $('#bulk-error-container').removeClass('hidden').addClass('fade-enter');
  }
  
  function showResult(result) {
    $('#result-nickname').text(result.nickname);
    $('#result-country').text(result.country);
    $('#result-container').removeClass('hidden').addClass('fade-enter');
  }

  // Download Template
  $('#download-template-btn').on('click', function() {
      window.location.href = '/api/template';
  });

  // Tutorial Modal
  const $modal = $('#tutorial-modal');
  const $modalContent = $('#tutorial-content');

  function openModal() {
      $modal.removeClass('hidden');
      setTimeout(() => {
          $modal.removeClass('opacity-0');
          $modalContent.removeClass('opacity-0 transform scale-95');
      }, 10);
  }

  function closeModal() {
      $modal.addClass('opacity-0');
      $modalContent.addClass('opacity-0 transform scale-95');
      setTimeout(() => {
          $modal.addClass('hidden');
      }, 300);
  }

  $('#show-tutorial-btn').on('click', openModal);
  $('#close-tutorial, #close-tutorial-btn-2').on('click', closeModal);
  
  // Close on outside click
  $modal.on('click', function(e) {
      if (e.target === this) {
          closeModal();
      }
  });